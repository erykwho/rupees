import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureAuditBackfill,
  recordAuditEvent,
  toAssetSnapshot,
  toTransactionSnapshot,
} from "@/lib/audit-service";

const updateAssetSchema = z.object({
  ticker: z.string().trim().min(1).max(30).optional(),
  assetClass: z
    .enum([
      "FIXED_INCOME",
      "BR_STOCK",
      "BR_FII",
      "US_STOCK",
      "US_REIT",
      "EMERGENCY_RESERVE",
    ])
    .optional(),
  sector: z.string().trim().min(1).max(100).optional(),
  targetPctInClass: z.coerce.number().min(0).max(100).optional(),
  priceMode: z.enum(["AUTO_YAHOO", "MANUAL"]).optional(),
  manualPrice: z.coerce.number().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  fixedIncomeIndex: z
    .enum([
      "CDI_PCT",
      "CDI_PLUS",
      "SELIC_PCT",
      "SELIC_PLUS",
      "IPCA_PLUS",
      "PREFIXED",
    ])
    .nullable()
    .optional(),
  fixedIncomeRate: z.coerce.number().min(0).max(1000).nullable().optional(),
  maturityDate: z.string().trim().nullable().optional(),
  taxExempt: z.boolean().optional(),
});

function parseOptionalMaturityDate(raw: string | null | undefined): Date | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw) return null;
  const parsed = new Date(
    raw.includes("T") ? raw : `${raw.slice(0, 10)}T12:00:00.000Z`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateAssetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    await ensureAuditBackfill(user.id);

    const existing = await prisma.asset.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Ativo não encontrado" }, { status: 404 });
    }

    const nextClass = parsed.data.assetClass ?? existing.assetClass;
    const nextSector = parsed.data.sector ?? existing.sector;
    const nextCurrency =
      nextClass === "US_STOCK" || nextClass === "US_REIT" ? "USD" : "BRL";
    const isFixedIncome =
      nextClass === "FIXED_INCOME" || nextClass === "EMERGENCY_RESERVE";

    const updated = await prisma.$transaction(async (tx) => {
      if (
        nextClass === "BR_STOCK" ||
        nextClass === "BR_FII" ||
        nextClass === "US_STOCK" ||
        nextClass === "US_REIT"
      ) {
        await tx.sectorGoal.upsert({
          where: {
            userId_assetClass_name: {
              userId: user.id,
              assetClass: nextClass,
              name: nextSector,
            },
          },
          update: {},
          create: {
            userId: user.id,
            assetClass: nextClass,
            name: nextSector,
            targetPct: 0,
          },
        });
      }

      const result = await tx.asset.update({
        where: { id: existing.id },
        data: {
          ticker: parsed.data.ticker?.toUpperCase(),
          assetClass: parsed.data.assetClass,
          currency: nextCurrency,
          sector: parsed.data.sector,
          targetPctInClass: parsed.data.targetPctInClass,
          priceMode: parsed.data.priceMode,
          manualPrice: parsed.data.manualPrice,
          isActive: parsed.data.isActive,
          fixedIncomeIndex: isFixedIncome ? parsed.data.fixedIncomeIndex : null,
          fixedIncomeRate: isFixedIncome ? parsed.data.fixedIncomeRate : null,
          maturityDate: isFixedIncome
            ? parseOptionalMaturityDate(parsed.data.maturityDate)
            : null,
          taxExempt: isFixedIncome ? parsed.data.taxExempt : false,
        },
      });

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "ASSET",
        entityId: result.id,
        entityLabel: result.ticker,
        action: "UPDATE",
        beforeState: toAssetSnapshot(existing),
        afterState: toAssetSnapshot(result),
      });

      return result;
    });

    return NextResponse.json({ asset: updated });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error("PATCH /api/assets/[id] error:", err);
    return NextResponse.json({ error: "Erro ao atualizar ativo" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    await ensureAuditBackfill(user.id);

    const existing = await prisma.asset.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Ativo não encontrado" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      const cascadeTxs = await tx.transaction.findMany({
        where: { assetId: existing.id, userId: user.id },
        include: {
          asset: {
            select: {
              id: true,
              ticker: true,
              assetClass: true,
              currency: true,
            },
          },
        },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      });

      await tx.asset.delete({ where: { id: existing.id } });

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "ASSET",
        entityId: existing.id,
        entityLabel: existing.ticker,
        action: "DELETE",
        beforeState: toAssetSnapshot(
          existing,
          cascadeTxs.map(toTransactionSnapshot)
        ),
        afterState: null,
      });
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao excluir ativo" }, { status: 500 });
  }
}
