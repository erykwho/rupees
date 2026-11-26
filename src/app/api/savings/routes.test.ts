import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  loadUserSavingsSummaryMock,
  recordAuditEventMock,
  invalidateUserSavingsCachesMock,
  prismaMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    savingsGoal: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
    savingsMovement: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    monthlyAllocation: {
      updateMany: vi.fn(),
    },
    emergencyReserveConfig: {
      upsert: vi.fn(),
    },
  };
  return {
    requireUserMock: vi.fn(),
    loadUserSavingsSummaryMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    invalidateUserSavingsCachesMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      savingsGoal: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      savingsVehicle: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      savingsMovement: {
        findFirst: vi.fn(),
        count: vi.fn(),
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
vi.mock("@/lib/savings-loader", () => ({
  loadUserSavingsSummary: loadUserSavingsSummaryMock,
}));
vi.mock("@/lib/audit-service", () => ({
  recordAuditEvent: recordAuditEventMock,
  toSavingsGoalSnapshot: vi.fn((g) => ({
    id: g.id,
    name: g.name,
    targetAmount: g.targetAmount !== null ? Number(g.targetAmount) : null,
    targetDate: null,
    isEmergencyReserve: Boolean(g.isEmergencyReserve),
    isClosed: Boolean(g.isClosed),
    sortOrder: g.sortOrder ?? 0,
  })),
  toSavingsMovementSnapshot: vi.fn((primary, counterpart) => ({
    id: primary.id,
    goalId: primary.goalId,
    goalName: primary.goal?.name ?? "Goal",
    vehicleId: primary.vehicleId,
    vehicleName: primary.vehicle?.name ?? "Vehicle",
    date: primary.date?.toISOString?.() ?? "2026-11-10T12:00:00.000Z",
    type: primary.type,
    signedAmount: Number(primary.signedAmount),
    transferGroupId: primary.transferGroupId ?? null,
    notes: primary.notes ?? null,
    ...(counterpart
      ? {
          counterpart: {
            id: counterpart.id,
            goalId: counterpart.goalId,
            goalName: counterpart.goal?.name ?? "Dest",
            vehicleId: counterpart.vehicleId,
            vehicleName: counterpart.vehicle?.name ?? "DestVehicle",
            date: counterpart.date?.toISOString?.() ?? "2026-11-10T12:00:00.000Z",
            type: counterpart.type,
            signedAmount: Number(counterpart.signedAmount),
            transferGroupId: counterpart.transferGroupId ?? null,
            notes: counterpart.notes ?? null,
          },
        }
      : {}),
  })),
  buildSavingsMovementEntityLabel: vi.fn(() => "Reserva (Aporte)"),
}));
vi.mock("@/lib/server-cache", () => ({
  invalidateUserSavingsCaches: invalidateUserSavingsCachesMock,
}));

import { GET as getSavings } from "@/app/api/savings/route";
import { POST as createGoal } from "@/app/api/savings/goals/route";
import {
  PATCH as patchGoal,
  DELETE as deleteGoal,
} from "@/app/api/savings/goals/[id]/route";
import { POST as createMovement } from "@/app/api/savings/movements/route";
import { DELETE as deleteMovement } from "@/app/api/savings/movements/[id]/route";
import { PUT as putReserveCalc } from "@/app/api/savings/reserve-calculator/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/savings/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    recordAuditEventMock.mockResolvedValue(undefined);
    loadUserSavingsSummaryMock.mockResolvedValue({ goals: [], vehicles: [] });
  });

  it("returns 401 when unauthenticated and 423 when app locked", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await getSavings()).status).toBe(401);

    requireUserMock.mockRejectedValueOnce(new Error("APP_LOCKED"));
    const lockedRes = await createGoal(
      jsonRequest("http://localhost/api/savings/goals", "POST", {
        name: "Viagem",
      })
    );
    expect(lockedRes.status).toBe(423);
  });

  it("blocks deleting a savings goal with linked movements (409) and enforces userId scoping (404 IDOR)", async () => {
    prismaMock.savingsGoal.findFirst.mockResolvedValueOnce(null);
    const idorRes = await patchGoal(
      jsonRequest("http://localhost/api/savings/goals/other-goal", "PATCH", {
        name: "Hacked",
      }),
      { params: Promise.resolve({ id: "other-goal" }) }
    );
    expect(idorRes.status).toBe(404);

    prismaMock.savingsGoal.findFirst.mockResolvedValueOnce({
      id: "g-1",
      userId: USER_A.id,
      name: "Reserva de Emergência",
      targetAmount: 120000,
      targetDate: null,
      isEmergencyReserve: true,
      isClosed: false,
      sortOrder: 0,
    });
    prismaMock.savingsMovement.count.mockResolvedValueOnce(3);

    const delRes = await deleteGoal(
      new Request("http://localhost/api/savings/goals/g-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "g-1" }) }
    );
    expect(delRes.status).toBe(409);
  });

  it("creates atomic transfer pair (TRANSFER_OUT + TRANSFER_IN), records single AuditEvent, and invalidates caches", async () => {
    prismaMock.savingsGoal.findMany.mockResolvedValueOnce([
      { id: "g-src" },
      { id: "g-dst" },
    ]);
    prismaMock.savingsVehicle.findMany.mockResolvedValueOnce([{ id: "v-1" }]);

    txMock.savingsMovement.create
      .mockResolvedValueOnce({
        id: "m-out",
        goalId: "g-src",
        vehicleId: "v-1",
        date: new Date("2026-11-10T12:00:00.000Z"),
        type: "TRANSFER_OUT",
        signedAmount: -500,
        transferGroupId: "tr_1",
        notes: "Remanejamento",
        goal: { id: "g-src", name: "Fundo Gatos" },
        vehicle: { id: "v-1", name: "Tesouro Selic 2031" },
      })
      .mockResolvedValueOnce({
        id: "m-in",
        goalId: "g-dst",
        vehicleId: "v-1",
        date: new Date("2026-11-10T12:00:00.000Z"),
        type: "TRANSFER_IN",
        signedAmount: 500,
        transferGroupId: "tr_1",
        notes: "Remanejamento",
        goal: { id: "g-dst", name: "Fundo reforma" },
        vehicle: { id: "v-1", name: "Tesouro Selic 2031" },
      });

    const res = await createMovement(
      jsonRequest("http://localhost/api/savings/movements", "POST", {
        mode: "TRANSFER",
        sourceGoalId: "g-src",
        sourceVehicleId: "v-1",
        destGoalId: "g-dst",
        destVehicleId: "v-1",
        date: "2026-11-10",
        amount: 500,
        notes: "Remanejamento",
      })
    );

    expect(res.status).toBe(201);
    expect(txMock.savingsMovement.create).toHaveBeenCalledTimes(2);
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(invalidateUserSavingsCachesMock).toHaveBeenCalledWith(USER_A.id);
  });

  it("rejects transfer to identical goal AND identical vehicle with 400", async () => {
    const res = await createMovement(
      jsonRequest("http://localhost/api/savings/movements", "POST", {
        mode: "TRANSFER",
        sourceGoalId: "g-1",
        sourceVehicleId: "v-1",
        destGoalId: "g-1",
        destVehicleId: "v-1",
        date: "2026-11-10",
        amount: 100,
      })
    );
    expect(res.status).toBe(400);
  });

  it("deletes both legs of a transfer pair atomically and records a single DELETE AuditEvent", async () => {
    prismaMock.savingsMovement.findFirst.mockResolvedValueOnce({
      id: "m-out",
      userId: USER_A.id,
      goalId: "g-src",
      vehicleId: "v-1",
      date: new Date("2026-11-10T12:00:00.000Z"),
      type: "TRANSFER_OUT",
      signedAmount: -500,
      transferGroupId: "tr_1",
      notes: null,
      goal: { id: "g-src", name: "Fundo Gatos" },
      vehicle: { id: "v-1", name: "Tesouro Selic 2031" },
    });
    txMock.savingsMovement.findMany.mockResolvedValueOnce([
      {
        id: "m-out",
        goalId: "g-src",
        vehicleId: "v-1",
        date: new Date("2026-11-10T12:00:00.000Z"),
        type: "TRANSFER_OUT",
        signedAmount: -500,
        transferGroupId: "tr_1",
        notes: null,
        goal: { id: "g-src", name: "Fundo Gatos" },
        vehicle: { id: "v-1", name: "Tesouro Selic 2031" },
      },
      {
        id: "m-in",
        goalId: "g-dst",
        vehicleId: "v-1",
        date: new Date("2026-11-10T12:00:00.000Z"),
        type: "TRANSFER_IN",
        signedAmount: 500,
        transferGroupId: "tr_1",
        notes: null,
        goal: { id: "g-dst", name: "Fundo reforma" },
        vehicle: { id: "v-1", name: "Tesouro Selic 2031" },
      },
    ]);

    const res = await deleteMovement(
      new Request("http://localhost/api/savings/movements/m-out", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "m-out" }) }
    );

    expect(res.status).toBe(200);
    expect(txMock.savingsMovement.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_A.id, id: { in: ["m-out", "m-in"] } },
    });
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
    expect(invalidateUserSavingsCachesMock).toHaveBeenCalledWith(USER_A.id);
  });

  it("saves reserve calculator config and applies target to emergency reserve goal when requested", async () => {
    txMock.savingsGoal.findFirst.mockResolvedValueOnce({
      id: "g-res",
      userId: USER_A.id,
      name: "Reserva de Emergência",
      targetAmount: 100000,
      targetDate: null,
      isEmergencyReserve: true,
      isClosed: false,
      sortOrder: 0,
    });
    txMock.savingsGoal.update.mockResolvedValueOnce({
      id: "g-res",
      userId: USER_A.id,
      name: "Reserva de Emergência",
      targetAmount: 120000,
      targetDate: null,
      isEmergencyReserve: true,
      isClosed: false,
      sortOrder: 0,
    });

    const res = await putReserveCalc(
      jsonRequest("http://localhost/api/savings/reserve-calculator", "PUT", {
        monthlyExpenseBRL: 20000,
        scenarios: [
          { id: "s1", label: "Desemprego", mode: "MONTHS", months: 6 },
          { id: "s2", label: "Médica", mode: "FIXED", fixedAmount: 100000 },
        ],
        applyToReserveGoal: true,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reserveCalculator.recommendedTargetBRL).toBe(120000);
    expect(body.appliedGoalId).toBe("g-res");
    expect(recordAuditEventMock).toHaveBeenCalledTimes(1);
  });
});
