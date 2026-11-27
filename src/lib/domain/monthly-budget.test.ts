import { describe, expect, it } from "vitest";
import {
  buildClonedMonthPayload,
  computeCheckingBalanceDelta,
  computeMonthlyBudgetSummary,
  formatMonthLongPtBR,
  formatMonthShortPtBR,
  getAdjacentYearMonth,
} from "./monthly-budget";

describe("monthly-budget domain engine", () => {
  it("matches Novembro/2026 cash flow formulas to the cent", () => {
    const summary = computeMonthlyBudgetSummary({
      id: "m-2026-11",
      year: 2026,
      month: 11,
      checkingBalance: 300,
      reportDate: "2026-11-10T12:00:00.000Z",
      notes: null,
      incomes: [
        { id: "i1", name: "Remuneração meio mes", amount: 9562.98, isReceived: false, isRecurring: true, sortOrder: 0 },
        { id: "i2", name: "Remuneração fim do mês", amount: 6341.99, isReceived: false, isRecurring: true, sortOrder: 1 },
        { id: "i3", name: "Venda ações fim do mês", amount: 22500, isReceived: false, isRecurring: true, sortOrder: 2 },
        { id: "i4", name: "Reembolso Laura Viagem", amount: 1200, isReceived: false, isRecurring: false, sortOrder: 3 },
      ],
      expenses: [
        { id: "e1", name: "Aluguel", category: "BILL", amount: 4600, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 0 },
        { id: "e2", name: "Cartão de Crédito - Itau", category: "VARIABLE", amount: 6000, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 1 },
        { id: "e3", name: "Apto Mooca", category: "INVESTMENT", amount: 6200, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 2 },
        { id: "e4", name: "Boleto Apto Mooca", category: "BILL", amount: 1000, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 3 },
        { id: "e5", name: "DARF", category: "TAX", amount: 5800, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 4 },
        { id: "e6", name: "Faculdade Liliane", category: "BILL", amount: 1000, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 5 },
        { id: "e7", name: "Metro Liliane", category: "BILL", amount: 70, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 6 },
        { id: "e8", name: "Boletos de Contas", category: "BILL", amount: 550, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 7 },
        { id: "e9", name: "Fornecedores", category: "BILL", amount: 18100, isUnexpected: true, isPaid: false, isRecurring: false, sortOrder: 8 },
      ],
      allocations: [
        { id: "a1", kind: "LONG_TERM_DEPOSIT", name: "Longo prazo", savingsGoalId: null, amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 0 },
        { id: "a2", kind: "SAVINGS_DEPOSIT", name: "Reserva de Emergência", savingsGoalId: "g-res", amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 1 },
        { id: "a3", kind: "SAVINGS_DEPOSIT", name: "Fundo próxima viagem", savingsGoalId: "g-trip", amount: 100, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 2 },
        { id: "a4", kind: "SAVINGS_DEPOSIT", name: "Fundo Darma", savingsGoalId: "g-darma", amount: 100, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 3 },
        { id: "a5", kind: "SAVINGS_DEPOSIT", name: "Fundo Gatos", savingsGoalId: "g-gatos", amount: 100, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 4 },
        { id: "a6", kind: "SAVINGS_WITHDRAWAL", name: "Para sacar de objetivos", savingsGoalId: "g-reforma", amount: 5000, isExecuted: false, linkedMovementId: null, isRecurring: false, sortOrder: 5 },
      ],
    });

    expect(summary.labelShort).toBe("Nov/2026");
    expect(summary.labelLong).toBe("Novembro de 2026");
    expect(summary.totals.totalIncomeBRL).toBe(39604.97);
    expect(summary.totals.taxExpensesBRL).toBe(5800);
    expect(summary.totals.netIncomeBRL).toBe(33804.97);
    expect(summary.totals.cashPlusPendingIncomeBRL).toBe(39904.97);
    expect(summary.totals.pendingSavingsWithdrawalsBRL).toBe(5000);
    expect(summary.totals.realAvailableCashBRL).toBe(44904.97);
    expect(summary.totals.totalExpensesBRL).toBe(43320);
    expect(summary.totals.pendingExpensesBRL).toBe(43320);
    expect(summary.totals.surplusBeforeInvestmentsBRL).toBe(1584.97);
    expect(summary.totals.plannedInvestmentsBRL).toBe(1300);
    expect(summary.totals.pendingInvestmentsBRL).toBe(1300);
    expect(summary.totals.finalSurplusBRL).toBe(284.97);
    expect(summary.regularExpenses).toHaveLength(8);
    expect(summary.unexpectedExpenses).toHaveLength(1);
  });

  it("handles already received incomes, already paid expenses, and already invested allocations like Outubro/2026", () => {
    const summary = computeMonthlyBudgetSummary({
      id: "m-2026-10",
      year: 2026,
      month: 10,
      checkingBalance: 13646.61,
      reportDate: "2026-10-30T12:00:00.000Z",
      notes: null,
      incomes: [
        { id: "i1", name: "Remuneração meio mes", amount: 9562.98, isReceived: true, isRecurring: true, sortOrder: 0 },
        { id: "i2", name: "Remuneração fim do mês", amount: 6341.99, isReceived: true, isRecurring: true, sortOrder: 1 },
        { id: "i3", name: "Venda ações fim do mês", amount: 22500, isReceived: false, isRecurring: true, sortOrder: 2 },
        { id: "i4", name: "Reembolso", amount: 753, isReceived: true, isRecurring: false, sortOrder: 3 },
        { id: "i5", name: "Reembolso Laura Viagem", amount: 1200, isReceived: false, isRecurring: false, sortOrder: 4 },
      ],
      expenses: [
        { id: "e1", name: "Aluguel", category: "BILL", amount: 4500, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 0 },
        { id: "e2", name: "Cartão", category: "VARIABLE", amount: 8384.18, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 1 },
        { id: "e3", name: "Apto Mooca", category: "INVESTMENT", amount: 6198.58, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 2 },
        { id: "e4", name: "Boleto Apto Mooca", category: "BILL", amount: 800, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 3 },
        { id: "e5", name: "DARF", category: "TAX", amount: 5789.49, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 4 },
        { id: "e6", name: "Faculdade Liliane", category: "BILL", amount: 683.78, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 5 },
        { id: "e7", name: "Metro Liliane", category: "BILL", amount: 70, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 6 },
        { id: "e8", name: "Boletos de Contas", category: "BILL", amount: 550, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 7 },
        { id: "e9", name: "Registro Imóvel", category: "BILL", amount: 719.9, isUnexpected: true, isPaid: true, isRecurring: false, sortOrder: 8 },
        { id: "e10", name: "Marceneiro", category: "BILL", amount: 32500, isUnexpected: true, isPaid: true, isRecurring: false, sortOrder: 9 },
        { id: "e11", name: "Empreiteiro", category: "BILL", amount: 17000, isUnexpected: true, isPaid: true, isRecurring: false, sortOrder: 10 },
        { id: "e12", name: "Marmoraria", category: "BILL", amount: 18000, isUnexpected: true, isPaid: true, isRecurring: false, sortOrder: 11 },
      ],
      allocations: [
        { id: "a1", kind: "LONG_TERM_DEPOSIT", name: "Longo prazo", savingsGoalId: null, amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 0 },
        { id: "a2", kind: "SAVINGS_DEPOSIT", name: "Reserva", savingsGoalId: "g-res", amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 1 },
        { id: "a3", kind: "SAVINGS_DEPOSIT", name: "Fundo reforma", savingsGoalId: "g-ref", amount: 9800, isExecuted: false, linkedMovementId: null, isRecurring: false, sortOrder: 2 },
        { id: "a4", kind: "SAVINGS_WITHDRAWAL", name: "Saque objetivo", savingsGoalId: "g-trip", amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: false, sortOrder: 3 },
      ],
    });

    expect(summary.totals.totalIncomeBRL).toBe(40357.97);
    expect(summary.totals.netIncomeBRL).toBe(34568.48);
    expect(summary.totals.cashPlusPendingIncomeBRL).toBe(37346.61);
    expect(summary.totals.realAvailableCashBRL).toBe(37846.61);
    expect(summary.totals.pendingExpensesBRL).toBe(26976.03);
    expect(summary.totals.paidExpensesBRL).toBe(68219.9);
    expect(summary.totals.surplusBeforeInvestmentsBRL).toBe(10870.58);
    expect(summary.totals.finalSurplusBRL).toBe(70.58);
  });

  it("clones recurring items, skips unexpected expenses and closed savings goals, and resets statuses", () => {
    const cloned = buildClonedMonthPayload(
      {
        incomes: [
          { id: "i1", name: "Salário", amount: 9000, isReceived: true, isRecurring: true, sortOrder: 0 },
          { id: "i2", name: "Reembolso avulso", amount: 500, isReceived: true, isRecurring: false, sortOrder: 1 },
        ],
        expenses: [
          { id: "e1", name: "Aluguel", category: "BILL", amount: 4600, isUnexpected: false, isPaid: true, isRecurring: true, sortOrder: 0 },
          { id: "e2", name: "Fornecedores", category: "BILL", amount: 18100, isUnexpected: true, isPaid: true, isRecurring: true, sortOrder: 1 },
          { id: "e3", name: "Conta pontual", category: "VARIABLE", amount: 300, isUnexpected: false, isPaid: true, isRecurring: false, sortOrder: 2 },
        ],
        allocations: [
          { id: "a1", kind: "LONG_TERM_DEPOSIT", name: "Longo prazo", savingsGoalId: null, amount: 500, isExecuted: true, linkedMovementId: null, isRecurring: true, sortOrder: 0 },
          { id: "a2", kind: "SAVINGS_DEPOSIT", name: "Reserva", savingsGoalId: "g-active", amount: 500, isExecuted: true, linkedMovementId: "mov-1", isRecurring: true, sortOrder: 1 },
          { id: "a3", kind: "SAVINGS_DEPOSIT", name: "Viagem fechada", savingsGoalId: "g-closed", amount: 200, isExecuted: true, linkedMovementId: "mov-2", isRecurring: true, sortOrder: 2 },
          { id: "a4", kind: "SAVINGS_WITHDRAWAL", name: "Saque reforma", savingsGoalId: "g-active", amount: 5000, isExecuted: true, linkedMovementId: "mov-3", isRecurring: false, sortOrder: 3 },
        ],
      },
      new Set(["g-active"])
    );

    expect(cloned.incomes).toEqual([
      { name: "Salário", amount: 9000, isReceived: false, isRecurring: true, sortOrder: 0 },
    ]);
    expect(cloned.expenses).toEqual([
      { name: "Aluguel", category: "BILL", amount: 4600, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 0 },
    ]);
    expect(cloned.allocations).toEqual([
      { kind: "LONG_TERM_DEPOSIT", name: "Longo prazo", savingsGoalId: null, amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 0 },
      { kind: "SAVINGS_DEPOSIT", name: "Reserva", savingsGoalId: "g-active", amount: 500, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 1 },
    ]);
  });

  it("computes checking balance deltas for completing and uncompleting monthly items and preserves finalSurplus", () => {
    // Marking completed (false -> true)
    expect(
      computeCheckingBalanceDelta({ kind: "INCOME", amount: 9562.98, wasCompleted: false, nextCompleted: true })
    ).toBe(9562.98);
    expect(
      computeCheckingBalanceDelta({ kind: "EXPENSE", amount: 4600, wasCompleted: false, nextCompleted: true })
    ).toBe(-4600);
    expect(
      computeCheckingBalanceDelta({ kind: "LONG_TERM_DEPOSIT", amount: 500, wasCompleted: false, nextCompleted: true })
    ).toBe(-500);
    expect(
      computeCheckingBalanceDelta({ kind: "SAVINGS_DEPOSIT", amount: 500, wasCompleted: false, nextCompleted: true })
    ).toBe(-500);
    expect(
      computeCheckingBalanceDelta({ kind: "SAVINGS_WITHDRAWAL", amount: 5000, wasCompleted: false, nextCompleted: true })
    ).toBe(5000);

    // Unmarking completed (true -> false) reverses sign
    expect(
      computeCheckingBalanceDelta({ kind: "INCOME", amount: 9562.98, wasCompleted: true, nextCompleted: false })
    ).toBe(-9562.98);
    expect(
      computeCheckingBalanceDelta({ kind: "EXPENSE", amount: 4600, wasCompleted: true, nextCompleted: false })
    ).toBe(4600);
    expect(
      computeCheckingBalanceDelta({ kind: "LONG_TERM_DEPOSIT", amount: 500, wasCompleted: true, nextCompleted: false })
    ).toBe(500);
    expect(
      computeCheckingBalanceDelta({ kind: "SAVINGS_DEPOSIT", amount: 500, wasCompleted: true, nextCompleted: false })
    ).toBe(500);
    expect(
      computeCheckingBalanceDelta({ kind: "SAVINGS_WITHDRAWAL", amount: 5000, wasCompleted: true, nextCompleted: false })
    ).toBe(-5000);

    // Idempotency: no transition or zero amount produces 0 (never -0)
    expect(
      computeCheckingBalanceDelta({ kind: "EXPENSE", amount: 100, wasCompleted: true, nextCompleted: true })
    ).toBe(0);
    expect(
      Object.is(
        computeCheckingBalanceDelta({ kind: "EXPENSE", amount: 0, wasCompleted: false, nextCompleted: true }),
        0
      )
    ).toBe(true);

    // Cash-flow invariance: adjusting checkingBalance when marking items keeps finalSurplus identical
    const baseInput = {
      id: "m-inv",
      year: 2026,
      month: 11,
      checkingBalance: 10000,
      reportDate: "2026-11-10T12:00:00.000Z",
      notes: null,
      incomes: [{ id: "i1", name: "Salário", amount: 5000, isReceived: false, isRecurring: true, sortOrder: 0 }],
      expenses: [{ id: "e1", name: "Aluguel", category: "BILL" as const, amount: 4000, isUnexpected: false, isPaid: false, isRecurring: true, sortOrder: 0 }],
      allocations: [
        { id: "a1", kind: "SAVINGS_DEPOSIT" as const, name: "Reserva", savingsGoalId: "g1", amount: 1000, isExecuted: false, linkedMovementId: null, isRecurring: true, sortOrder: 0 },
        { id: "a2", kind: "SAVINGS_WITHDRAWAL" as const, name: "Saque", savingsGoalId: "g2", amount: 2000, isExecuted: false, linkedMovementId: null, isRecurring: false, sortOrder: 1 },
      ],
    };

    const before = computeMonthlyBudgetSummary(baseInput);
    const totalDelta =
      computeCheckingBalanceDelta({ kind: "INCOME", amount: 5000, wasCompleted: false, nextCompleted: true }) +
      computeCheckingBalanceDelta({ kind: "EXPENSE", amount: 4000, wasCompleted: false, nextCompleted: true }) +
      computeCheckingBalanceDelta({ kind: "SAVINGS_DEPOSIT", amount: 1000, wasCompleted: false, nextCompleted: true }) +
      computeCheckingBalanceDelta({ kind: "SAVINGS_WITHDRAWAL", amount: 2000, wasCompleted: false, nextCompleted: true });

    const after = computeMonthlyBudgetSummary({
      ...baseInput,
      checkingBalance: baseInput.checkingBalance + totalDelta,
      incomes: baseInput.incomes.map((i) => ({ ...i, isReceived: true })),
      expenses: baseInput.expenses.map((e) => ({ ...e, isPaid: true })),
      allocations: baseInput.allocations.map((a) => ({ ...a, isExecuted: true })),
    });

    expect(after.checkingBalance).toBe(12000);
    expect(after.totals.finalSurplusBRL).toBe(before.totals.finalSurplusBRL);
  });

  it("handles month formatting and year rollovers", () => {
    expect(formatMonthShortPtBR(2026, 1)).toBe("Jan/2026");
    expect(formatMonthLongPtBR(2026, 12)).toBe("Dezembro de 2026");
    expect(getAdjacentYearMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(getAdjacentYearMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});
