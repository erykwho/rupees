import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadUserMonthlyBudgetPageData } from "@/lib/monthly-budget-loader";
import {
  buildClonedMonthPayload,
  type MonthlyAllocationKindKey,
  type MonthlyExpenseCategoryKey,
} from "@/lib/domain/monthly-budget";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const createMonthlyBudgetSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  checkingBalance: z.number().optional(),
  reportDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)")
    .optional(),
  cloneFromBudgetId: z.string().min(1).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const rawYear = searchParams.get("year");
    const rawMonth = searchParams.get("month");

    const year = rawYear ? Number(rawYear) : undefined;
    const month = rawMonth ? Number(rawMonth) : undefined;

    if (
      (year !== undefined && (!Number.isInteger(year) || year < 2020 || year > 2100)) ||
      (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12))
    ) {
      return NextResponse.json(
        { error: "Ano ou mês inválido" },
        { status: 400 }
      );
    }

    const data = await loadUserMonthlyBudgetPageData(user.id, {
      year,
      month,
    });

    return NextResponse.json(data);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/monthly-budget error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar controle do mês" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createMonthlyBudgetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { year, month, checkingBalance, reportDate, cloneFromBudgetId } =
      parsed.data;

    const existing = await prisma.monthlyBudget.findUnique({
      where: {
        userId_year_month: {
          userId: user.id,
          year,
          month,
        },
      },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Este mês já existe no seu controle mensal." },
        { status: 409 }
      );
    }

    let sourceBudget = null;
    if (cloneFromBudgetId) {
      sourceBudget = await prisma.monthlyBudget.findFirst({
        where: { id: cloneFromBudgetId, userId: user.id },
        include: {
          incomes: { orderBy: { sortOrder: "asc" } },
          expenses: { orderBy: { sortOrder: "asc" } },
          allocations: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!sourceBudget) {
        return NextResponse.json(
          { error: "Mês de origem para clonagem não encontrado" },
          { status: 404 }
        );
      }
    }

    const activeGoalIds = sourceBudget
      ? new Set(
          (
            await prisma.savingsGoal.findMany({
              where: { userId: user.id, isClosed: false },
              select: { id: true },
            })
          ).map((g) => g.id)
        )
      : new Set<string>();

    const cloned = sourceBudget
      ? buildClonedMonthPayload(
          {
            incomes: sourceBudget.incomes.map((i) => ({
              id: i.id,
              name: i.name,
              amount: Number(i.amount),
              isReceived: i.isReceived,
              isRecurring: i.isRecurring,
              sortOrder: i.sortOrder,
            })),
            expenses: sourceBudget.expenses.map((e) => ({
              id: e.id,
              name: e.name,
              category: e.category as MonthlyExpenseCategoryKey,
              amount: Number(e.amount),
              isUnexpected: e.isUnexpected,
              isPaid: e.isPaid,
              isRecurring: e.isRecurring,
              sortOrder: e.sortOrder,
            })),
            allocations: sourceBudget.allocations.map((a) => ({
              id: a.id,
              kind: a.kind as MonthlyAllocationKindKey,
              name: a.name,
              savingsGoalId: a.savingsGoalId,
              amount: Number(a.amount),
              isExecuted: a.isExecuted,
              linkedMovementId: a.linkedMovementId,
              isRecurring: a.isRecurring,
              sortOrder: a.sortOrder,
            })),
          },
          activeGoalIds
        )
      : null;

    const createdBudget = await prisma.$transaction(async (tx) => {
      const budget = await tx.monthlyBudget.create({
        data: {
          userId: user.id,
          year,
          month,
          checkingBalance: checkingBalance ?? 0,
          reportDate: reportDate
            ? new Date(`${reportDate}T12:00:00.000Z`)
            : new Date(),
        },
      });

      if (cloned && cloned.incomes.length > 0) {
        await tx.monthlyIncome.createMany({
          data: cloned.incomes.map((item) => ({
            userId: user.id,
            budgetId: budget.id,
            ...item,
          })),
        });
      }

      if (cloned && cloned.expenses.length > 0) {
        await tx.monthlyExpense.createMany({
          data: cloned.expenses.map((item) => ({
            userId: user.id,
            budgetId: budget.id,
            ...item,
          })),
        });
      }

      if (cloned && cloned.allocations.length > 0) {
        await tx.monthlyAllocation.createMany({
          data: cloned.allocations.map((item) => ({
            userId: user.id,
            budgetId: budget.id,
            ...item,
          })),
        });
      }

      return budget;
    });

    invalidateUserMonthlyBudgetCaches(user.id);
    const data = await loadUserMonthlyBudgetPageData(user.id, {
      year: createdBudget.year,
      month: createdBudget.month,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Este mês já existe no seu controle mensal." },
        { status: 409 }
      );
    }
    console.error("POST /api/monthly-budget error:", err);
    return NextResponse.json(
      { error: "Erro ao criar controle do mês" },
      { status: 500 }
    );
  }
}
