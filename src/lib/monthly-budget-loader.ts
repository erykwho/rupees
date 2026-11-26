import { prisma } from "@/lib/prisma";
import {
  computeMonthlyBudgetSummary,
  formatMonthShortPtBR,
  type MonthlyAllocationKindKey,
  type MonthlyBudgetSummary,
  type MonthlyExpenseCategoryKey,
} from "@/lib/domain/monthly-budget";
import {
  DEFAULT_USER_CACHE_TTL_SECONDS,
  runCachedForUser,
  userMonthlyBudgetTag,
} from "@/lib/server-cache";

export interface AvailableMonthOption {
  id: string;
  year: number;
  month: number;
  labelShort: string;
}

export interface ActiveSavingsGoalOption {
  id: string;
  name: string;
  isEmergencyReserve: boolean;
  lastVehicleId: string | null;
}

export interface ActiveSavingsVehicleOption {
  id: string;
  name: string;
  institution: string | null;
}

export interface MonthlyBudgetPageData {
  selectedYear: number;
  selectedMonth: number;
  budget: MonthlyBudgetSummary | null;
  availableMonths: AvailableMonthOption[];
  activeSavingsGoals: ActiveSavingsGoalOption[];
  activeSavingsVehicles: ActiveSavingsVehicleOption[];
}

export interface MonthlyBudgetHomeSummary {
  budget: MonthlyBudgetSummary | null;
  currentYear: number;
  currentMonth: number;
}

export function getCurrentYearMonthBRT(now: Date = new Date()): {
  year: number;
  month: number;
} {
  // Use Sao Paulo time so Brazilian users switch months accurately around midnight BRT
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(
    parts.find((p) => p.type === "year")?.value ?? now.getUTCFullYear()
  );
  const month = Number(
    parts.find((p) => p.type === "month")?.value ?? now.getUTCMonth() + 1
  );
  return { year, month };
}

export async function loadUserMonthlyBudgetPageData(
  userId: string,
  options?: { year?: number; month?: number }
): Promise<MonthlyBudgetPageData> {
  const [allMonths, activeGoals, activeVehicles, latestMovements] =
    await Promise.all([
      prisma.monthlyBudget.findMany({
        where: { userId },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        select: { id: true, year: true, month: true },
      }),
      prisma.savingsGoal.findMany({
        where: { userId, isClosed: false },
        orderBy: [{ isEmergencyReserve: "desc" }, { sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, isEmergencyReserve: true },
      }),
      prisma.savingsVehicle.findMany({
        where: { userId, isArchived: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, institution: true },
      }),
      prisma.savingsMovement.findMany({
        where: { userId },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        distinct: ["goalId"],
        select: { goalId: true, vehicleId: true },
      }),
    ]);

  const nowYM = getCurrentYearMonthBRT();
  let selectedYear = options?.year;
  let selectedMonth = options?.month;

  if (!selectedYear || !selectedMonth) {
    // Prefer current calendar month if it exists, otherwise the latest existing month, otherwise current calendar month
    const hasCurrent = allMonths.some(
      (m) => m.year === nowYM.year && m.month === nowYM.month
    );
    if (hasCurrent) {
      selectedYear = nowYM.year;
      selectedMonth = nowYM.month;
    } else if (allMonths.length > 0) {
      selectedYear = allMonths[0].year;
      selectedMonth = allMonths[0].month;
    } else {
      selectedYear = nowYM.year;
      selectedMonth = nowYM.month;
    }
  }

  const rawBudget = await prisma.monthlyBudget.findUnique({
    where: {
      userId_year_month: {
        userId,
        year: selectedYear,
        month: selectedMonth,
      },
    },
    include: {
      incomes: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      expenses: { orderBy: [{ isUnexpected: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] },
      allocations: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        include: {
          savingsGoal: { select: { id: true, name: true } },
        },
      },
    },
  });

  const budget = rawBudget
    ? computeMonthlyBudgetSummary({
        id: rawBudget.id,
        year: rawBudget.year,
        month: rawBudget.month,
        checkingBalance: Number(rawBudget.checkingBalance),
        reportDate: rawBudget.reportDate.toISOString(),
        notes: rawBudget.notes,
        incomes: rawBudget.incomes.map((i) => ({
          id: i.id,
          name: i.name,
          amount: Number(i.amount),
          isReceived: i.isReceived,
          isRecurring: i.isRecurring,
          sortOrder: i.sortOrder,
        })),
        expenses: rawBudget.expenses.map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category as MonthlyExpenseCategoryKey,
          amount: Number(e.amount),
          isUnexpected: e.isUnexpected,
          isPaid: e.isPaid,
          isRecurring: e.isRecurring,
          sortOrder: e.sortOrder,
        })),
        allocations: rawBudget.allocations.map((a) => ({
          id: a.id,
          kind: a.kind as MonthlyAllocationKindKey,
          name: a.name,
          savingsGoalId: a.savingsGoalId,
          savingsGoalName: a.savingsGoal?.name ?? null,
          amount: Number(a.amount),
          isExecuted: a.isExecuted,
          linkedMovementId: a.linkedMovementId,
          isRecurring: a.isRecurring,
          sortOrder: a.sortOrder,
        })),
      })
    : null;

  const lastVehicleByGoal = new Map(
    latestMovements.map((m) => [m.goalId, m.vehicleId])
  );

  return {
    selectedYear,
    selectedMonth,
    budget,
    availableMonths: allMonths.map((m) => ({
      id: m.id,
      year: m.year,
      month: m.month,
      labelShort: formatMonthShortPtBR(m.year, m.month),
    })),
    activeSavingsGoals: activeGoals.map((g) => ({
      id: g.id,
      name: g.name,
      isEmergencyReserve: g.isEmergencyReserve,
      lastVehicleId: lastVehicleByGoal.get(g.id) ?? null,
    })),
    activeSavingsVehicles: activeVehicles,
  };
}

export async function loadCachedUserMonthlyBudgetHomeSummary(
  userId: string
): Promise<MonthlyBudgetHomeSummary> {
  return runCachedForUser({
    keyPrefix: "user-monthly-home-v1",
    userId,
    tags: [userMonthlyBudgetTag(userId)],
    revalidateSeconds: DEFAULT_USER_CACHE_TTL_SECONDS,
    loader: async () => {
      const nowYM = getCurrentYearMonthBRT();
      const pageData = await loadUserMonthlyBudgetPageData(userId);
      return {
        budget: pageData.budget,
        currentYear: nowYM.year,
        currentMonth: nowYM.month,
      };
    },
  });
}
