import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeCheckingBalanceDelta } from "@/lib/domain/monthly-budget";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const updateAllocationSchema = z.object({
  kind: z
    .enum(["LONG_TERM_DEPOSIT", "SAVINGS_DEPOSIT", "SAVINGS_WITHDRAWAL"])
    .optional(),
  name: z.string().trim().min(1).max(100).optional(),
  savingsGoalId: z.string().min(1).nullable().optional(),
  amount: z.number().min(0).optional(),
  isExecuted: z.boolean().optional(),
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
    const parsed = updateAllocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.monthlyAllocation.findFirst({
      where: { id: itemId, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Item de aporte/saque não encontrado" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    const nextKind = data.kind ?? existing.kind;
    let nextSavingsGoalId: string | null | undefined = data.savingsGoalId;

    if (nextKind === "LONG_TERM_DEPOSIT") {
      nextSavingsGoalId = null;
    } else if (nextSavingsGoalId) {
      const goal = await prisma.savingsGoal.findFirst({
        where: { id: nextSavingsGoalId, userId: user.id },
        select: { id: true },
      });
      if (!goal) {
        return NextResponse.json(
          { error: "Caixinha vinculada não encontrada" },
          { status: 404 }
        );
      }
    }

    const updateData = {
      ...(data.kind !== undefined ? { kind: data.kind } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(nextSavingsGoalId !== undefined
        ? { savingsGoalId: nextSavingsGoalId }
        : {}),
      ...(data.amount !== undefined ? { amount: roundMoney(data.amount) } : {}),
      ...(data.isExecuted !== undefined ? { isExecuted: data.isExecuted } : {}),
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
      data.adjustCheckingBalance && data.isExecuted !== undefined
        ? computeCheckingBalanceDelta({
            kind: nextKind,
            amount: effectiveAmount,
            wasCompleted: existing.isExecuted,
            nextCompleted: data.isExecuted,
          })
        : 0;

    let updated;
    let updatedCheckingBalance: number | undefined;

    if (balanceDelta !== 0) {
      const txResult = await prisma.$transaction(async (tx) => {
        const updatedAllocation = await tx.monthlyAllocation.update({
          where: { id: itemId },
          data: updateData,
          include: {
            savingsGoal: { select: { id: true, name: true } },
          },
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
        return { updatedAllocation, nextCheckingBalance };
      });
      updated = txResult.updatedAllocation;
      updatedCheckingBalance = txResult.nextCheckingBalance;
    } else {
      updated = await prisma.monthlyAllocation.update({
        where: { id: itemId },
        data: updateData,
        include: {
          savingsGoal: { select: { id: true, name: true } },
        },
      });
    }

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({
      allocation: {
        id: updated.id,
        kind: updated.kind,
        name: updated.name,
        savingsGoalId: updated.savingsGoalId,
        savingsGoalName: updated.savingsGoal?.name ?? null,
        amount: Number(updated.amount),
        isExecuted: updated.isExecuted,
        linkedMovementId: updated.linkedMovementId,
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
    console.error("PATCH /api/monthly-budget/allocations/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar aporte/saque" },
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

    const existing = await prisma.monthlyAllocation.findFirst({
      where: { id: itemId, userId: user.id },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Item de aporte/saque não encontrado" },
        { status: 404 }
      );
    }

    await prisma.monthlyAllocation.delete({ where: { id: itemId } });
    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/monthly-budget/allocations/[itemId] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir aporte/saque" },
      { status: 500 }
    );
  }
}
