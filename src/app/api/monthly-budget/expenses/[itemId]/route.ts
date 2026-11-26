import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const updateExpenseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  category: z.enum(["BILL", "VARIABLE", "INVESTMENT", "TAX"]).optional(),
  amount: z.number().min(0).optional(),
  isUnexpected: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireUser();
    const { itemId } = await context.params;
    const body = await request.json();
    const parsed = updateExpenseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.monthlyExpense.findFirst({
      where: { id: itemId, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Despesa não encontrada" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    const updated = await prisma.monthlyExpense.update({
      where: { id: itemId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.amount !== undefined ? { amount: roundMoney(data.amount) } : {}),
        ...(data.isUnexpected !== undefined
          ? { isUnexpected: data.isUnexpected }
          : {}),
        ...(data.isPaid !== undefined ? { isPaid: data.isPaid } : {}),
        ...(data.isRecurring !== undefined
          ? { isRecurring: data.isRecurring }
          : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({
      expense: {
        id: updated.id,
        name: updated.name,
        category: updated.category,
        amount: Number(updated.amount),
        isUnexpected: updated.isUnexpected,
        isPaid: updated.isPaid,
        isRecurring: updated.isRecurring,
        sortOrder: updated.sortOrder,
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("PATCH /api/monthly-budget/expenses/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar despesa" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireUser();
    const { itemId } = await context.params;

    const existing = await prisma.monthlyExpense.findFirst({
      where: { id: itemId, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Despesa não encontrada" },
        { status: 404 }
      );
    }

    await prisma.monthlyExpense.delete({ where: { id: itemId } });
    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/monthly-budget/expenses/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir despesa" },
      { status: 500 }
    );
  }
}
