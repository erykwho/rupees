import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  loadUserMonthlyBudgetPageDataMock,
  recordAuditEventMock,
  invalidateUserMonthlyBudgetCachesMock,
  invalidateUserSavingsCachesMock,
  prismaMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    monthlyBudget: {
      create: vi.fn(),
    },
    monthlyIncome: {
      createMany: vi.fn(),
    },
    monthlyExpense: {
      createMany: vi.fn(),
    },
    monthlyAllocation: {
      createMany: vi.fn(),
      update: vi.fn(),
    },
    savingsMovement: {
      create: vi.fn(),
    },
  };
  return {
    requireUserMock: vi.fn(),
    loadUserMonthlyBudgetPageDataMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    invalidateUserMonthlyBudgetCachesMock: vi.fn(),
    invalidateUserSavingsCachesMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      monthlyBudget: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      monthlyIncome: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      monthlyExpense: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      monthlyAllocation: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      savingsGoal: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      savingsVehicle: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock,
  authErrorResponse: (err: unknown) => {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "APP_LOCKED") {
      return NextResponse.json(
        { error: "Aplicativo bloqueado", code: "APP_LOCKED" },
        { status: 423 }
      );
    }
    return null;
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/monthly-budget-loader", () => ({
  loadUserMonthlyBudgetPageData: loadUserMonthlyBudgetPageDataMock,
}));
vi.mock("@/lib/audit-service", () => ({
  recordAuditEvent: recordAuditEventMock,
  toSavingsMovementSnapshot: vi.fn((m) => ({
    id: m.id,
    goalId: m.goalId,
    goalName: m.goal?.name ?? "Reserva",
    vehicleId: m.vehicleId,
    vehicleName: m.vehicle?.name ?? "Selic",
    date: m.date.toISOString(),
    type: m.type,
    signedAmount: Number(m.signedAmount),
    transferGroupId: null,
    notes: m.notes ?? null,
  })),
  buildSavingsMovementEntityLabel: vi.fn(() => "Reserva (Aporte)"),
}));
vi.mock("@/lib/server-cache", () => ({
  invalidateUserMonthlyBudgetCaches: invalidateUserMonthlyBudgetCachesMock,
  invalidateUserSavingsCaches: invalidateUserSavingsCachesMock,
}));

import { GET as getMonthly, POST as createMonthly } from "@/app/api/monthly-budget/route";
import { PATCH as patchIncome } from "@/app/api/monthly-budget/incomes/[itemId]/route";
import { POST as executeToSavings } from "@/app/api/monthly-budget/allocations/[itemId]/execute-to-savings/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/monthly-budget/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    recordAuditEventMock.mockResolvedValue(undefined);
    loadUserMonthlyBudgetPageDataMock.mockResolvedValue({
      selectedYear: 2026,
      selectedMonth: 12,
      budget: null,
      availableMonths: [],
      activeSavingsGoals: [],
      activeSavingsVehicles: [],
    });
  });

  it("returns 401 unauthenticated and 400 on invalid query params", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect(
      (await getMonthly(new Request("http://localhost/api/monthly-budget"))).status
    ).toBe(401);

    const badRes = await getMonthly(
      new Request("http://localhost/api/monthly-budget?year=2026&month=13")
    );
    expect(badRes.status).toBe(400);
  });

  it("prevents IDOR when patching another user's monthly income item (404)", async () => {
    prismaMock.monthlyIncome.findFirst.mockResolvedValueOnce(null);
    const res = await patchIncome(
      jsonRequest("http://localhost/api/monthly-budget/incomes/other-id", "PATCH", {
        isReceived: true,
      }),
      { params: Promise.resolve({ itemId: "other-id" }) }
    );
    expect(res.status).toBe(404);
  });

  it("clones recurring items when creating a new month from a previous month", async () => {
    prismaMock.monthlyBudget.findUnique.mockResolvedValueOnce(null);
    prismaMock.monthlyBudget.findFirst.mockResolvedValueOnce({
      id: "b-nov",
      userId: USER_A.id,
      incomes: [
        { id: "i1", name: "Salário", amount: 9000, isReceived: true, isRecurring: true, sortOrder: 0 },
        { id: "i2", name: "Extra", amount: 500, isReceived: true, isRecurring: false, sortOrder: 1 },
      ],
      expenses: [
        { id: "e1", name: "Aluguel", category: "BILL", amount: 4600, isUnexpected: false, isPaid: true, isRecurring: true, sortOrder: 0 },
        { id: "e2", name: "Fornecedores", category: "BILL", amount: 18000, isUnexpected: true, isPaid: true, isRecurring: true, sortOrder: 1 },
      ],
      allocations: [
        { id: "a1", kind: "SAVINGS_DEPOSIT", name: "Reserva", savingsGoalId: "g-active", amount: 500, isExecuted: true, linkedMovementId: "m1", isRecurring: true, sortOrder: 0 },
        { id: "a2", kind: "SAVINGS_DEPOSIT", name: "Fechada", savingsGoalId: "g-closed", amount: 200, isExecuted: true, linkedMovementId: "m2", isRecurring: true, sortOrder: 1 },
      ],
    });
    prismaMock.savingsGoal.findMany.mockResolvedValueOnce([{ id: "g-active" }]);
    txMock.monthlyBudget.create.mockResolvedValueOnce({
      id: "b-dec",
      year: 2026,
      month: 12,
    });

    const res = await createMonthly(
      jsonRequest("http://localhost/api/monthly-budget", "POST", {
        year: 2026,
        month: 12,
        cloneFromBudgetId: "b-nov",
      })
    );

    expect(res.status).toBe(201);
    expect(txMock.monthlyIncome.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.monthlyExpense.createMany).toHaveBeenCalledTimes(1);
    expect(txMock.monthlyAllocation.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          userId: USER_A.id,
          budgetId: "b-dec",
          savingsGoalId: "g-active",
          isExecuted: false,
          linkedMovementId: null,
        }),
      ],
    });
    expect(invalidateUserMonthlyBudgetCachesMock).toHaveBeenCalledWith(USER_A.id);
  });

  it("executes a monthly savings allocation into Caixinhas atomically with AuditEvent and links movementId", async () => {
    prismaMock.monthlyAllocation.findFirst.mockResolvedValueOnce({
      id: "a-res",
      userId: USER_A.id,
      kind: "SAVINGS_DEPOSIT",
      name: "Reserva de Emergência",
      savingsGoalId: "g-res",
      amount: 500,
      isExecuted: false,
      linkedMovementId: null,
      budget: { year: 2026, month: 11 },
    });
    prismaMock.savingsGoal.findFirst.mockResolvedValueOnce({
      id: "g-res",
      name: "Reserva de Emergência",
    });
    prismaMock.savingsVehicle.findFirst.mockResolvedValueOnce({ id: "v-selic" });

    txMock.savingsMovement.create.mockResolvedValueOnce({
      id: "mov-new",
      goalId: "g-res",
      vehicleId: "v-selic",
      date: new Date("2026-11-15T12:00:00.000Z"),
      type: "DEPOSIT",
      signedAmount: 500,
      notes: "Aporte via Controle de Nov/2026",
      goal: { id: "g-res", name: "Reserva de Emergência" },
      vehicle: { id: "v-selic", name: "Tesouro Selic 2031" },
    });
    txMock.monthlyAllocation.update.mockResolvedValueOnce({
      id: "a-res",
      kind: "SAVINGS_DEPOSIT",
      name: "Reserva de Emergência",
      savingsGoalId: "g-res",
      savingsGoal: { id: "g-res", name: "Reserva de Emergência" },
      amount: 500,
      isExecuted: true,
      linkedMovementId: "mov-new",
      isRecurring: true,
      sortOrder: 0,
    });

    const res = await executeToSavings(
      jsonRequest(
        "http://localhost/api/monthly-budget/allocations/a-res/execute-to-savings",
        "POST",
        {
          vehicleId: "v-selic",
          date: "2026-11-15",
        }
      ),
      { params: Promise.resolve({ itemId: "a-res" }) }
    );

    expect(res.status).toBe(201);
    expect(txMock.savingsMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_A.id,
          goalId: "g-res",
          vehicleId: "v-selic",
          type: "DEPOSIT",
          signedAmount: 500,
        }),
      })
    );
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(invalidateUserSavingsCachesMock).toHaveBeenCalledWith(USER_A.id);
  });

  it("blocks double execution when linkedMovementId is already present (409)", async () => {
    prismaMock.monthlyAllocation.findFirst.mockResolvedValueOnce({
      id: "a-res",
      userId: USER_A.id,
      kind: "SAVINGS_DEPOSIT",
      name: "Reserva",
      savingsGoalId: "g-res",
      amount: 500,
      isExecuted: true,
      linkedMovementId: "mov-already",
      budget: { year: 2026, month: 11 },
    });

    const res = await executeToSavings(
      jsonRequest(
        "http://localhost/api/monthly-budget/allocations/a-res/execute-to-savings",
        "POST",
        {
          vehicleId: "v-selic",
          date: "2026-11-15",
        }
      ),
      { params: Promise.resolve({ itemId: "a-res" }) }
    );
    expect(res.status).toBe(409);
  });
});
