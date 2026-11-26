import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const createAllocationSchema = z.object({
  kind: z.enum(["LONG_TERM_DEPOSIT", "SAVINGS_DEPOSIT", "SAVINGS_WITHDRAWAL"]),
  name: z.string().trim().min(1, "Informe a descrição").max(100).optional(),
  savingsGoalId: z.string().min(1).nullable().optional(),
  amount: z.number().min(0),
  isExecuted: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: budgetId } = await context.params;
    const body = await request.json();
    const parsed = createAllocationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const budget = await prisma.monthlyBudget.findFirst({
      where: { id: budgetId, userId: user.id },
      select: { id: true },
    });
    if (!budget) {
      return NextResponse.json(
        { error: "Controle mensal não encontrado" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    let resolvedGoalName: string | null = null;
    const resolvedGoalId =
      data.kind === "LONG_TERM_DEPOSIT" ? null : (data.savingsGoalId ?? null);

    if (resolvedGoalId) {
      const goal = await prisma.savingsGoal.findFirst({
        where: { id: resolvedGoalId, userId: user.id },
        select: { id: true, name: true },
      });
      if (!goal) {
        return NextResponse.json(
          { error: "Caixinha vinculada não encontrada" },
          { status: 404 }
        );
      }
      resolvedGoalName = goal.name;
    }

    const name =
      data.name?.trim() ||
      resolvedGoalName ||
      (data.kind === "LONG_TERM_DEPOSIT"
        ? "Longo prazo"
        : data.kind === "SAVINGS_WITHDRAWAL"
          ? "Saque de caixinha"
          : "Aporte em caixinha");

    const count = await prisma.monthlyAllocation.count({ where: { budgetId } });
    const defaultRecurring = data.kind !== "SAVINGS_WITHDRAWAL";

    const created = await prisma.monthlyAllocation.create({
      data: {
        userId: user.id,
        budgetId,
        kind: data.kind,
        name,
        savingsGoalId: resolvedGoalId,
        amount: roundMoney(data.amount),
        isExecuted: data.isExecuted ?? false,
        isRecurring: data.isRecurring ?? defaultRecurring,
        sortOrder: data.sortOrder ?? count,
      },
      include: {
        savingsGoal: { select: { id: true, name: true } },
      },
    });

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json(
      {
        allocation: {
          id: created.id,
          kind: created.kind,
          name: created.name,
          savingsGoalId: created.savingsGoalId,
          savingsGoalName: created.savingsGoal?.name ?? null,
          amount: Number(created.amount),
          isExecuted: created.isExecuted,
          linkedMovementId: created.linkedMovementId,
          isRecurring: created.isRecurring,
          sortOrder: created.sortOrder,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("POST /api/monthly-budget/[id]/allocations error:", err);
    return NextResponse.json(
      { error: "Erro ao adicionar aporte/saque" },
      { status: 500 }
    );
  }
}
