import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeCheckingBalanceDelta } from "@/lib/domain/monthly-budget";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const updateIncomeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  amount: z.number().min(0).optional(),
  isReceived: z.boolean().optional(),
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
    const parsed = updateIncomeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.monthlyIncome.findFirst({
      where: { id: itemId, userId: user.id },
      select: { id: true, budgetId: true, amount: true, isReceived: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Receita não encontrada" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    const updateData = {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.amount !== undefined ? { amount: roundMoney(data.amount) } : {}),
      ...(data.isReceived !== undefined ? { isReceived: data.isReceived } : {}),
      ...(data.isRecurring !== undefined ? { isRecurring: data.isRecurring } : {}),
      ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    };

    const effectiveAmount =
      data.amount !== undefined
        ? roundMoney(data.amount)
        : Number(existing.amount);
    const balanceDelta =
      data.adjustCheckingBalance && data.isReceived !== undefined
        ? computeCheckingBalanceDelta({
            kind: "INCOME",
            amount: effectiveAmount,
            wasCompleted: existing.isReceived,
            nextCompleted: data.isReceived,
          })
        : 0;

    let updated;
    let updatedCheckingBalance: number | undefined;

    if (balanceDelta !== 0) {
      const txResult = await prisma.$transaction(async (tx) => {
        const updatedIncome = await tx.monthlyIncome.update({
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
        return { updatedIncome, nextCheckingBalance };
      });
      updated = txResult.updatedIncome;
      updatedCheckingBalance = txResult.nextCheckingBalance;
    } else {
      updated = await prisma.monthlyIncome.update({
        where: { id: itemId },
        data: updateData,
      });
    }

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({
      income: {
        id: updated.id,
        name: updated.name,
        amount: Number(updated.amount),
        isReceived: updated.isReceived,
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
    console.error("PATCH /api/monthly-budget/incomes/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar receita" },
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

    const existing = await prisma.monthlyIncome.findFirst({
      where: { id: itemId, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Receita não encontrada" },
        { status: 404 }
      );
    }

    await prisma.monthlyIncome.delete({ where: { id: itemId } });
    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/monthly-budget/incomes/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir receita" },
      { status: 500 }
    );
  }
}
