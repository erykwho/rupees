import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildTransactionEntityLabel,
  ensureAuditBackfill,
  recordAuditEvent,
  toTransactionSnapshot,
} from "@/lib/audit-service";

const createTransactionSchema = z.object({
  assetId: z.string().min(1),
  date: z.string().min(1),
  type: z.enum(["BUY", "SELL", "BALANCE_ADJUSTMENT"]).default("BUY"),
  quantity: z.coerce.number().refine((v) => v !== 0, "Quantidade não pode ser zero"),
  unitPrice: z.coerce.number().min(0).optional(),
  totalAmount: z.coerce.number().optional(),
  fixedIncomeRate: z.coerce.number().min(0).max(1000).nullable().optional(),
  notes: z.string().max(300).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get("assetId") || undefined;

    const transactions = await prisma.transaction.findMany({
      where: {
        userId: user.id,
        ...(assetId ? { assetId } : {}),
      },
      include: {
        asset: {
          select: {
            id: true,
            ticker: true,
            assetClass: true,
            currency: true,
            sector: true,
            fixedIncomeIndex: true,
            fixedIncomeRate: true,
          },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    return NextResponse.json({
      transactions: transactions.map((t) => ({
        id: t.id,
        assetId: t.assetId,
        date: t.date.toISOString(),
        type: t.type,
        quantity: Number(t.quantity),
        unitPrice: Number(t.unitPrice),
        totalAmount: Number(t.totalAmount),
        fixedIncomeRate:
          t.fixedIncomeRate !== null ? Number(t.fixedIncomeRate) : null,
        notes: t.notes,
        asset: {
          ...t.asset,
          fixedIncomeRate:
            t.asset.fixedIncomeRate !== null
              ? Number(t.asset.fixedIncomeRate)
              : null,
        },
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao listar lançamentos" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const asset = await prisma.asset.findFirst({
      where: { id: parsed.data.assetId, userId: user.id },
    });
    if (!asset) {
      return NextResponse.json({ error: "Ativo não encontrado" }, { status: 404 });
    }

    const isAdjustment = parsed.data.type === "BALANCE_ADJUSTMENT";
    const isFixedIncomeBuy =
      parsed.data.type === "BUY" &&
      (asset.assetClass === "FIXED_INCOME" ||
        asset.assetClass === "EMERGENCY_RESERVE");
    const quantity = isAdjustment
      ? parsed.data.quantity
      : Math.abs(parsed.data.quantity);

    let totalAmount =
      parsed.data.totalAmount !== undefined
        ? isAdjustment
          ? parsed.data.totalAmount
          : Math.abs(parsed.data.totalAmount)
        : 0;
    let unitPrice = parsed.data.unitPrice ?? 0;

    if (totalAmount === 0 && unitPrice > 0) {
      totalAmount = quantity * unitPrice;
    } else if (unitPrice === 0 && Math.abs(quantity) > 0) {
      unitPrice = Math.abs(totalAmount / quantity);
    }

    const parsedDate = new Date(
      parsed.data.date.includes("T")
        ? parsed.data.date
        : `${parsed.data.date}T12:00:00.000Z`
    );

    await ensureAuditBackfill(user.id);

    const tx = await prisma.$transaction(async (db) => {
      const created = await db.transaction.create({
        data: {
          userId: user.id,
          assetId: asset.id,
          date: parsedDate,
          type: parsed.data.type,
          quantity,
          unitPrice: isAdjustment ? 1 : unitPrice,
          totalAmount,
          fixedIncomeRate: isFixedIncomeBuy
            ? (parsed.data.fixedIncomeRate ?? null)
            : null,
          notes: parsed.data.notes ?? null,
        },
        include: {
          asset: {
            select: {
              id: true,
              ticker: true,
              assetClass: true,
              currency: true,
              sector: true,
              fixedIncomeIndex: true,
              fixedIncomeRate: true,
            },
          },
        },
      });

      const snap = toTransactionSnapshot(created);
      await recordAuditEvent(db, {
        userId: user.id,
        entityType: "TRANSACTION",
        entityId: created.id,
        entityLabel: buildTransactionEntityLabel(snap),
        action: "CREATE",
        beforeState: null,
        afterState: snap,
      });

      return created;
    });

    return NextResponse.json(
      {
        transaction: {
          id: tx.id,
          assetId: tx.assetId,
          date: tx.date.toISOString(),
          type: tx.type,
          quantity: Number(tx.quantity),
          unitPrice: Number(tx.unitPrice),
          totalAmount: Number(tx.totalAmount),
          fixedIncomeRate:
            tx.fixedIncomeRate !== null ? Number(tx.fixedIncomeRate) : null,
          notes: tx.notes,
          asset: {
            ...tx.asset,
            fixedIncomeRate:
              tx.asset.fixedIncomeRate !== null
                ? Number(tx.asset.fixedIncomeRate)
                : null,
          },
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error("POST /api/transactions error:", err);
    return NextResponse.json(
      { error: "Erro ao registrar lançamento" },
      { status: 500 }
    );
  }
}
