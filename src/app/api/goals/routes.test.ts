import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  ensureAuditBackfillMock,
  recordAuditEventMock,
  prismaMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    allocationGoal: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  };
  return {
    requireUserMock: vi.fn(),
    ensureAuditBackfillMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      allocationGoal: { upsert: vi.fn() },
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
vi.mock("@/lib/audit-service", () => ({
  ensureAuditBackfill: ensureAuditBackfillMock,
  recordAuditEvent: recordAuditEventMock,
  toGoalSnapshot: vi.fn((g) => ({ id: g.id })),
}));

import { GET, PUT } from "@/app/api/goals/route";

const USER_A = { id: "user-a", email: "a@example.com" };

const VALID_GOALS = {
  fixedIncomePct: 20,
  variableIncomePct: 80,
  brazilPct: 60,
  usaPct: 40,
  brStocksPct: 70,
  brFiisPct: 30,
  usStocksPct: 75,
  usReitsPct: 25,
};

function putRequest(body: unknown): Request {
  return new Request("http://localhost/api/goals", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    ensureAuditBackfillMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it("retorna 401 quando não autenticado e 423 quando App Lock está bloqueado", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHORIZED"));
    expect((await GET()).status).toBe(401);

    requireUserMock.mockRejectedValueOnce(new Error("APP_LOCKED"));
    expect((await PUT(putRequest(VALID_GOALS))).status).toBe(423);
  });

  it("enforça invariantes de hierarquia somando 100% em todos os níveis (400)", async () => {
    const invalidCases = [
      { ...VALID_GOALS, fixedIncomePct: 30, variableIncomePct: 80 }, // RF + RV != 100
      { ...VALID_GOALS, brazilPct: 50, usaPct: 40 }, // BR + EUA != 100
      { ...VALID_GOALS, brStocksPct: 60, brFiisPct: 30 }, // Ações + FIIs != 100
      { ...VALID_GOALS, usStocksPct: 80, usReitsPct: 25 }, // Stocks + REITs != 100
    ];

    for (const payload of invalidCases) {
      const res = await PUT(putRequest(payload));
      expect(res.status).toBe(400);
    }

    expect(txMock.allocationGoal.upsert).not.toHaveBeenCalled();
  });

  it("salva objetivos válidos com escopo userId e registra auditoria", async () => {
    txMock.allocationGoal.findUnique.mockResolvedValue({ id: "g1" });
    txMock.allocationGoal.upsert.mockResolvedValue({
      id: "g1",
      userId: USER_A.id,
      ...VALID_GOALS,
    });

    const res = await PUT(putRequest(VALID_GOALS));
    expect(res.status).toBe(200);
    expect(txMock.allocationGoal.upsert).toHaveBeenCalledWith({
      where: { userId: USER_A.id },
      update: VALID_GOALS,
      create: { userId: USER_A.id, ...VALID_GOALS },
    });
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      txMock,
      expect.objectContaining({
        userId: USER_A.id,
        entityType: "GOAL",
        action: "UPDATE",
      })
    );
  });
});
