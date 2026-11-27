import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSavingsMovementEntityLabel,
  recordAuditEvent,
  toSavingsMovementSnapshot,
} from "@/lib/audit-service";
import { roundMoney } from "@/lib/domain/savings";
import {
  computeCheckingBalanceDelta,
  formatMonthShortPtBR,
} from "@/lib/domain/monthly-budget";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const executeToSavingsSchema = z.object({
  goalId: z.string().min(1).optional(),
  vehicleId: z.string().min(1, "Selecione onde o valor foi aplicado/sacado"),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)"),
  amount: z.number().positive("O valor deve ser maior que zero").optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  adjustCheckingBalance: z.boolean().optional(),
});

/**
 * Assisted 1-click bridge from Monthly Budget (Hoje) to Savings Buckets (Amanhã):
 * atomically creates the DEPOSIT or WITHDRAWAL in SavingsMovement + AuditEvent,
 * marks the MonthlyAllocation as executed with linkedMovementId, and optionally
 * adjusts MonthlyBudget.checkingBalance in the same transaction.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ itemId: string }> }
) {
  try {
    const user = await requireUser();
    const { itemId } = await context.params;
    const body = await request.json();
    const parsed = executeToSavingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const allocation = await prisma.monthlyAllocation.findFirst({
      where: { id: itemId, userId: user.id },
      include: {
        budget: { select: { year: true, month: true } },
      },
    });
    if (!allocation) {
      return NextResponse.json(
        { error: "Item de aporte/saque não encontrado" },
        { status: 404 }
      );
    }

    if (allocation.kind === "LONG_TERM_DEPOSIT") {
      return NextResponse.json(
        { error: "Itens de longo prazo devem ser lançados no Plano de Aporte." },
        { status: 400 }
      );
    }

    if (allocation.linkedMovementId) {
      return NextResponse.json(
        { error: "Este item já possui uma movimentação lançada nas Caixinhas." },
        { status: 409 }
      );
    }

    const targetGoalId = parsed.data.goalId ?? allocation.savingsGoalId;
    if (!targetGoalId) {
      return NextResponse.json(
        { error: "Selecione uma caixinha para registrar esta movimentação." },
        { status: 400 }
      );
    }

    const amount = roundMoney(parsed.data.amount ?? Number(allocation.amount));
    if (amount <= 0) {
      return NextResponse.json(
        { error: "O valor deve ser maior que zero." },
        { status: 400 }
      );
    }

    const [goal, vehicle] = await Promise.all([
      prisma.savingsGoal.findFirst({
        where: { id: targetGoalId, userId: user.id },
        select: { id: true, name: true },
      }),
      prisma.savingsVehicle.findFirst({
        where: { id: parsed.data.vehicleId, userId: user.id },
        select: { id: true },
      }),
    ]);

    if (!goal) {
      return NextResponse.json(
        { error: "Caixinha não encontrada" },
        { status: 404 }
      );
    }
    if (!vehicle) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 }
      );
    }

    const isWithdrawal = allocation.kind === "SAVINGS_WITHDRAWAL";
    const movementType = isWithdrawal ? "WITHDRAWAL" : "DEPOSIT";
    const signedAmount = isWithdrawal ? -amount : amount;
    const defaultNote = `${isWithdrawal ? "Saque" : "Aporte"} via Controle de ${formatMonthShortPtBR(
      allocation.budget.year,
      allocation.budget.month
    )}`;
    const balanceDelta = parsed.data.adjustCheckingBalance
      ? computeCheckingBalanceDelta({
          kind: allocation.kind,
          amount,
          wasCompleted: allocation.isExecuted,
          nextCompleted: true,
        })
      : 0;

    const result = await prisma.$transaction(async (tx) => {
      const createdMovement = await tx.savingsMovement.create({
        data: {
          userId: user.id,
          goalId: targetGoalId,
          vehicleId: parsed.data.vehicleId,
          date: new Date(`${parsed.data.date}T12:00:00.000Z`),
          type: movementType,
          signedAmount,
          notes: parsed.data.notes?.trim() || defaultNote,
        },
        include: {
          goal: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true } },
        },
      });

      const movSnap = toSavingsMovementSnapshot(createdMovement);
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_MOVEMENT",
        entityId: createdMovement.id,
        entityLabel: buildSavingsMovementEntityLabel(movSnap),
        action: "CREATE",
        beforeState: null,
        afterState: movSnap,
      });

      const updatedAllocation = await tx.monthlyAllocation.update({
        where: { id: allocation.id },
        data: {
          savingsGoalId: targetGoalId,
          isExecuted: true,
          linkedMovementId: createdMovement.id,
        },
        include: {
          savingsGoal: { select: { id: true, name: true } },
        },
      });

      let updatedCheckingBalance: number | undefined;
      if (balanceDelta !== 0) {
        const parentBudget = await tx.monthlyBudget.findFirst({
          where: { id: allocation.budgetId, userId: user.id },
          select: { id: true, checkingBalance: true },
        });
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
          updatedCheckingBalance = Number(updatedBudget.checkingBalance);
        }
      }

      return { movSnap, updatedAllocation, updatedCheckingBalance };
    });

    // Invalidates both savings and monthly-budget tags
    invalidateUserSavingsCaches(user.id);

    return NextResponse.json(
      {
        movement: result.movSnap,
        allocation: {
          id: result.updatedAllocation.id,
          kind: result.updatedAllocation.kind,
          name: result.updatedAllocation.name,
          savingsGoalId: result.updatedAllocation.savingsGoalId,
          savingsGoalName: result.updatedAllocation.savingsGoal?.name ?? null,
          amount: Number(result.updatedAllocation.amount),
          isExecuted: result.updatedAllocation.isExecuted,
          linkedMovementId: result.updatedAllocation.linkedMovementId,
          isRecurring: result.updatedAllocation.isRecurring,
          sortOrder: result.updatedAllocation.sortOrder,
        },
        ...(result.updatedCheckingBalance !== undefined
          ? {
              checkingBalance: result.updatedCheckingBalance,
              checkingBalanceDelta: balanceDelta,
            }
          : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error(
      "POST /api/monthly-budget/allocations/[itemId]/execute-to-savings error:",
      err
    );
    return NextResponse.json(
      { error: "Erro ao lançar movimentação na caixinha" },
      { status: 500 }
    );
  }
}
