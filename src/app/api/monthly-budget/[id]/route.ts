import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const updateMonthlyBudgetSchema = z.object({
  checkingBalance: z.number().optional(),
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)")
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateMonthlyBudgetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.monthlyBudget.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Controle mensal não encontrado" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    const updated = await prisma.monthlyBudget.update({
      where: { id },
      data: {
        ...(data.checkingBalance !== undefined
          ? { checkingBalance: roundMoney(data.checkingBalance) }
          : {}),
        ...(data.reportDate !== undefined
          ? { reportDate: new Date(`${data.reportDate}T12:00:00.000Z`) }
          : data.checkingBalance !== undefined
            ? { reportDate: new Date() }
            : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      },
    });

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({
      budget: {
        id: updated.id,
        checkingBalance: Number(updated.checkingBalance),
        reportDate: updated.reportDate.toISOString(),
        notes: updated.notes,
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("PATCH /api/monthly-budget/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar saldo do mês" },
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

    const existing = await prisma.monthlyBudget.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Controle mensal não encontrado" },
        { status: 404 }
      );
    }

    await prisma.monthlyBudget.delete({ where: { id } });
    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/monthly-budget/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir mês" },
      { status: 500 }
    );
  }
}
