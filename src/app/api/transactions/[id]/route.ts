import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const updateTransactionSchema = z.object({
  assetId: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  type: z.enum(["BUY", "SELL", "BALANCE_ADJUSTMENT"]).optional(),
  quantity: z.coerce.number().optional(),
  unitPrice: z.coerce.number().min(0).optional(),
  totalAmount: z.coerce.number().optional(),
  notes: z.string().max(300).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateTransactionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Lançamento não encontrado" },
        { status: 404 }
      );
    }

    const nextType = parsed.data.type ?? existing.type;
    const isAdjustment = nextType === "BALANCE_ADJUSTMENT";
    const nextQty =
      parsed.data.quantity !== undefined
        ? isAdjustment
          ? parsed.data.quantity
          : Math.abs(parsed.data.quantity)
        : Number(existing.quantity);

    let nextTotal =
      parsed.data.totalAmount !== undefined
        ? isAdjustment
          ? parsed.data.totalAmount
          : Math.abs(parsed.data.totalAmount)
        : Number(existing.totalAmount);

    let nextUnit =
      parsed.data.unitPrice !== undefined
        ? parsed.data.unitPrice
        : Number(existing.unitPrice);

    if (
      parsed.data.totalAmount !== undefined &&
      parsed.data.unitPrice === undefined &&
      Math.abs(nextQty) > 0
    ) {
      nextUnit = Math.abs(nextTotal / nextQty);
    } else if (
      parsed.data.unitPrice !== undefined &&
      parsed.data.totalAmount === undefined
    ) {
      nextTotal = nextQty * nextUnit;
    }

    const nextDate = parsed.data.date
      ? new Date(
          parsed.data.date.includes("T")
            ? parsed.data.date
            : `${parsed.data.date}T12:00:00.000Z`
        )
      : existing.date;

    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: {
        assetId: parsed.data.assetId ?? existing.assetId,
        date: nextDate,
        type: nextType,
        quantity: nextQty,
        unitPrice: isAdjustment ? 1 : nextUnit,
        totalAmount: nextTotal,
        notes: parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
      },
      include: {
        asset: {
          select: {
            id: true,
            ticker: true,
            assetClass: true,
            currency: true,
            sector: true,
          },
        },
      },
    });

    return NextResponse.json({
      transaction: {
        id: updated.id,
        assetId: updated.assetId,
        date: updated.date.toISOString(),
        type: updated.type,
        quantity: Number(updated.quantity),
        unitPrice: Number(updated.unitPrice),
        totalAmount: Number(updated.totalAmount),
        notes: updated.notes,
        asset: updated.asset,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao atualizar lançamento" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.transaction.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Lançamento não encontrado" },
        { status: 404 }
      );
    }

    await prisma.transaction.delete({ where: { id: existing.id } });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao remover lançamento" },
      { status: 500 }
    );
  }
}
