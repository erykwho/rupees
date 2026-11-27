import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeCheckingBalanceDelta } from "@/lib/domain/monthly-budget";
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
  adjustCheckingBalance: z.boolean().optional(),
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
      select: { id: true, budgetId: true, amount: true, isPaid: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Despesa não encontrada" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    const updateData = {
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
    };

    const effectiveAmount =
      data.amount !== undefined
        ? roundMoney(data.amount)
        : Number(existing.amount);
    const balanceDelta =
      data.adjustCheckingBalance && data.isPaid !== undefined
        ? computeCheckingBalanceDelta({
            kind: "EXPENSE",
            amount: effectiveAmount,
            wasCompleted: existing.isPaid,
            nextCompleted: data.isPaid,
          })
        : 0;

    let updated;
    let updatedCheckingBalance: number | undefined;

    if (balanceDelta !== 0) {
      const txResult = await prisma.$transaction(async (tx) => {
        const updatedExpense = await tx.monthlyExpense.update({
          where: { id: itemId },
          data: updateData,
        });
        const parentBudget = await tx.monthlyBudget.findFirst({
          where: { id: existing.budgetId, userId: user.id },
          select: { id: true, checkingBalance: true },
        });
        let nextCheckingBalance: number | undefined;
        if (parentBudget) {
          const updatedBudget = await tx.monthlyBudget.update({
            where: { id: parentBudget.id },
            data: {
              checkingBalance: roundMoney(
                Number(parentBudget.checkingBalance) + balanceDelta
              ),
              reportDate: new Date(),
            },
            select: { checkingBalance: true },
          });
          nextCheckingBalance = Number(updatedBudget.checkingBalance);
        }
        return { updatedExpense, nextCheckingBalance };
      });
      updated = txResult.updatedExpense;
      updatedCheckingBalance = txResult.nextCheckingBalance;
    } else {
      updated = await prisma.monthlyExpense.update({
        where: { id: itemId },
        data: updateData,
      });
    }

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
      ...(updatedCheckingBalance !== undefined
        ? {
            checkingBalance: updatedCheckingBalance,
            checkingBalanceDelta: balanceDelta,
          }
        : {}),
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
