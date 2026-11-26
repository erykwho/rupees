import { roundMoney } from "./savings";

export type MonthlyExpenseCategoryKey =
  | "BILL"
  | "VARIABLE"
  | "INVESTMENT"
  | "TAX";

export type MonthlyAllocationKindKey =
  | "LONG_TERM_DEPOSIT"
  | "SAVINGS_DEPOSIT"
  | "SAVINGS_WITHDRAWAL";

export const MONTHLY_EXPENSE_CATEGORY_LABELS: Record<
  MonthlyExpenseCategoryKey,
  string
> = {
  BILL: "Conta",
  VARIABLE: "Variável",
  INVESTMENT: "Investimento",
  TAX: "Imposto",
};

export const MONTHLY_ALLOCATION_KIND_LABELS: Record<
  MonthlyAllocationKindKey,
  string
> = {
  LONG_TERM_DEPOSIT: "Longo prazo",
  SAVINGS_DEPOSIT: "Aporte em caixinha",
  SAVINGS_WITHDRAWAL: "Saque de caixinha",
};

export interface MonthlyIncomeItem {
  id: string;
  name: string;
  amount: number;
  isReceived: boolean;
  isRecurring: boolean;
  sortOrder: number;
}

export interface MonthlyExpenseItem {
  id: string;
  name: string;
  category: MonthlyExpenseCategoryKey;
  amount: number;
  isUnexpected: boolean;
  isPaid: boolean;
  isRecurring: boolean;
  sortOrder: number;
}

export interface MonthlyExpenseWithShare extends MonthlyExpenseItem {
  sharePct: number;
}

export interface MonthlyAllocationItem {
  id: string;
  kind: MonthlyAllocationKindKey;
  name: string;
  savingsGoalId: string | null;
  savingsGoalName?: string | null;
  amount: number;
  isExecuted: boolean;
  linkedMovementId: string | null;
  isRecurring: boolean;
  sortOrder: number;
}

export interface MonthlyBudgetInput {
  id: string;
  year: number;
  month: number;
  checkingBalance: number;
  reportDate: string; // ISO string
  notes: string | null;
  incomes: MonthlyIncomeItem[];
  expenses: MonthlyExpenseItem[];
  allocations: MonthlyAllocationItem[];
}

export interface MonthlyBudgetTotals {
  totalIncomeBRL: number;
  receivedIncomeBRL: number;
  pendingIncomeBRL: number;
  taxExpensesBRL: number;
  netIncomeBRL: number;
  cashPlusPendingIncomeBRL: number;
  totalSavingsWithdrawalsBRL: number;
  executedSavingsWithdrawalsBRL: number;
  pendingSavingsWithdrawalsBRL: number;
  realAvailableCashBRL: number;
  totalExpensesBRL: number;
  paidExpensesBRL: number;
  pendingExpensesBRL: number;
  surplusBeforeInvestmentsBRL: number;
  plannedInvestmentsBRL: number;
  alreadyInvestedBRL: number;
  pendingInvestmentsBRL: number;
  finalSurplusBRL: number;
  pendingIncomeCount: number;
  pendingExpenseCount: number;
  pendingAllocationCount: number;
}

export interface MonthlyBudgetSummary {
  id: string;
  year: number;
  month: number;
  labelShort: string;
  labelLong: string;
  checkingBalance: number;
  reportDate: string;
  notes: string | null;
  incomes: MonthlyIncomeItem[];
  regularExpenses: MonthlyExpenseWithShare[];
  unexpectedExpenses: MonthlyExpenseWithShare[];
  expenses: MonthlyExpenseWithShare[];
  depositAllocations: MonthlyAllocationItem[];
  withdrawalAllocations: MonthlyAllocationItem[];
  allocations: MonthlyAllocationItem[];
  totals: MonthlyBudgetTotals;
}

export interface ClonedMonthPayload {
  incomes: Array<{
    name: string;
    amount: number;
    isReceived: boolean;
    isRecurring: boolean;
    sortOrder: number;
  }>;
  expenses: Array<{
    name: string;
    category: MonthlyExpenseCategoryKey;
    amount: number;
    isUnexpected: boolean;
    isPaid: boolean;
    isRecurring: boolean;
    sortOrder: number;
  }>;
  allocations: Array<{
    kind: MonthlyAllocationKindKey;
    name: string;
    savingsGoalId: string | null;
    amount: number;
    isExecuted: boolean;
    linkedMovementId: null;
    isRecurring: boolean;
    sortOrder: number;
  }>;
}

const MONTH_SHORT_PT_BR = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

const MONTH_LONG_PT_BR = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

export function formatMonthShortPtBR(year: number, month: number): string {
  const idx = Math.min(12, Math.max(1, Math.trunc(month))) - 1;
  return `${MONTH_SHORT_PT_BR[idx]}/${year}`;
}

export function formatMonthLongPtBR(year: number, month: number): string {
  const idx = Math.min(12, Math.max(1, Math.trunc(month))) - 1;
  return `${MONTH_LONG_PT_BR[idx]} de ${year}`;
}

export function getAdjacentYearMonth(
  year: number,
  month: number,
  deltaMonths: number
): { year: number; month: number } {
  const totalMonths = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12 + 1;
  return { year: nextYear, month: nextMonth };
}

export function computeMonthlyBudgetSummary(
  input: MonthlyBudgetInput
): MonthlyBudgetSummary {
  const checkingBalance = roundMoney(input.checkingBalance);

  const incomes = [...input.incomes]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));

  const rawExpenses = [...input.expenses]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));

  const allocations = [...input.allocations]
    .map((item) => ({ ...item, amount: roundMoney(item.amount) }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));

  const totalIncomeBRL = roundMoney(
    incomes.reduce((sum, item) => sum + item.amount, 0)
  );
  const receivedIncomeBRL = roundMoney(
    incomes
      .filter((item) => item.isReceived)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const pendingIncomeBRL = roundMoney(
    incomes
      .filter((item) => !item.isReceived)
      .reduce((sum, item) => sum + item.amount, 0)
  );

  const totalExpensesBRL = roundMoney(
    rawExpenses.reduce((sum, item) => sum + item.amount, 0)
  );
  const paidExpensesBRL = roundMoney(
    rawExpenses
      .filter((item) => item.isPaid)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const pendingExpensesBRL = roundMoney(
    rawExpenses
      .filter((item) => !item.isPaid)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const taxExpensesBRL = roundMoney(
    rawExpenses
      .filter((item) => item.category === "TAX")
      .reduce((sum, item) => sum + item.amount, 0)
  );

  const netIncomeBRL = roundMoney(totalIncomeBRL - taxExpensesBRL);

  const expenses: MonthlyExpenseWithShare[] = rawExpenses.map((item) => ({
    ...item,
    sharePct:
      totalExpensesBRL > 0
        ? roundMoney((item.amount / totalExpensesBRL) * 100)
        : 0,
  }));

  const regularExpenses = expenses.filter((item) => !item.isUnexpected);
  const unexpectedExpenses = expenses.filter((item) => item.isUnexpected);

  const depositAllocations = allocations.filter(
    (item) =>
      item.kind === "LONG_TERM_DEPOSIT" || item.kind === "SAVINGS_DEPOSIT"
  );
  const withdrawalAllocations = allocations.filter(
    (item) => item.kind === "SAVINGS_WITHDRAWAL"
  );

  const totalSavingsWithdrawalsBRL = roundMoney(
    withdrawalAllocations.reduce((sum, item) => sum + item.amount, 0)
  );
  const executedSavingsWithdrawalsBRL = roundMoney(
    withdrawalAllocations
      .filter((item) => item.isExecuted)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const pendingSavingsWithdrawalsBRL = roundMoney(
    withdrawalAllocations
      .filter((item) => !item.isExecuted)
      .reduce((sum, item) => sum + item.amount, 0)
  );

  const cashPlusPendingIncomeBRL = roundMoney(
    checkingBalance + pendingIncomeBRL
  );
  const realAvailableCashBRL = roundMoney(
    cashPlusPendingIncomeBRL + pendingSavingsWithdrawalsBRL
  );

  const surplusBeforeInvestmentsBRL = roundMoney(
    realAvailableCashBRL - pendingExpensesBRL
  );

  const plannedInvestmentsBRL = roundMoney(
    depositAllocations.reduce((sum, item) => sum + item.amount, 0)
  );
  const alreadyInvestedBRL = roundMoney(
    depositAllocations
      .filter((item) => item.isExecuted)
      .reduce((sum, item) => sum + item.amount, 0)
  );
  const pendingInvestmentsBRL = roundMoney(
    plannedInvestmentsBRL - alreadyInvestedBRL
  );

  const finalSurplusBRL = roundMoney(
    surplusBeforeInvestmentsBRL - pendingInvestmentsBRL
  );

  const pendingIncomeCount = incomes.filter((item) => !item.isReceived).length;
  const pendingExpenseCount = rawExpenses.filter((item) => !item.isPaid).length;
  const pendingAllocationCount = allocations.filter(
    (item) => !item.isExecuted && item.amount > 0
  ).length;

  return {
    id: input.id,
    year: input.year,
    month: input.month,
    labelShort: formatMonthShortPtBR(input.year, input.month),
    labelLong: formatMonthLongPtBR(input.year, input.month),
    checkingBalance,
    reportDate: input.reportDate,
    notes: input.notes,
    incomes,
    regularExpenses,
    unexpectedExpenses,
    expenses,
    depositAllocations,
    withdrawalAllocations,
    allocations,
    totals: {
      totalIncomeBRL,
      receivedIncomeBRL,
      pendingIncomeBRL,
      taxExpensesBRL,
      netIncomeBRL,
      cashPlusPendingIncomeBRL,
      totalSavingsWithdrawalsBRL,
      executedSavingsWithdrawalsBRL,
      pendingSavingsWithdrawalsBRL,
      realAvailableCashBRL,
      totalExpensesBRL,
      paidExpensesBRL,
      pendingExpensesBRL,
      surplusBeforeInvestmentsBRL,
      plannedInvestmentsBRL,
      alreadyInvestedBRL,
      pendingInvestmentsBRL,
      finalSurplusBRL,
      pendingIncomeCount,
      pendingExpenseCount,
      pendingAllocationCount,
    },
  };
}

/**
 * Builds the item payload for a new month by cloning recurring items from a source month.
 * - Unexpected expenses are always excluded.
 * - All statuses (isReceived, isPaid, isExecuted) are reset to false.
 * - Savings allocations linked to a closed/deleted savings goal are skipped.
 */
export function buildClonedMonthPayload(
  source: Pick<MonthlyBudgetInput, "incomes" | "expenses" | "allocations">,
  activeSavingsGoalIds: ReadonlySet<string>
): ClonedMonthPayload {
  const incomes = source.incomes
    .filter((item) => item.isRecurring)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, idx) => ({
      name: item.name,
      amount: roundMoney(item.amount),
      isReceived: false,
      isRecurring: true,
      sortOrder: idx,
    }));

  const expenses = source.expenses
    .filter((item) => item.isRecurring && !item.isUnexpected)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, idx) => ({
      name: item.name,
      category: item.category,
      amount: roundMoney(item.amount),
      isUnexpected: false,
      isPaid: false,
      isRecurring: true,
      sortOrder: idx,
    }));

  const allocations = source.allocations
    .filter((item) => {
      if (!item.isRecurring) return false;
      if (item.savingsGoalId && !activeSavingsGoalIds.has(item.savingsGoalId)) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item, idx) => ({
      kind: item.kind,
      name: item.name,
      savingsGoalId: item.savingsGoalId,
      amount: roundMoney(item.amount),
      isExecuted: false,
      linkedMovementId: null,
      isRecurring: true,
      sortOrder: idx,
    }));

  return { incomes, expenses, allocations };
}
