import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  ensureSectorGoalsBackfillMock,
  ensureAuditBackfillMock,
  recordAuditEventMock,
  prismaMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    sectorGoal: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    asset: {
      updateMany: vi.fn(),
    },
  };
  return {
    requireUserMock: vi.fn(),
    ensureSectorGoalsBackfillMock: vi.fn(),
    ensureAuditBackfillMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      sectorGoal: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      asset: {
        findMany: vi.fn(),
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
vi.mock("@/lib/sector-goals", () => ({
  ensureSectorGoalsBackfill: ensureSectorGoalsBackfillMock,
}));
vi.mock("@/lib/audit-service", () => ({
  ensureAuditBackfill: ensureAuditBackfillMock,
  recordAuditEvent: recordAuditEventMock,
  buildSectorGoalEntityLabel: vi.fn(() => "Bancos"),
  toSectorGoalSnapshot: vi.fn((sg) => ({ id: sg.id, name: sg.name })),
}));

import { GET, POST } from "@/app/api/sector-goals/route";
import { PATCH, DELETE } from "@/app/api/sector-goals/[id]/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/sector-goals/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    ensureSectorGoalsBackfillMock.mockResolvedValue(undefined);
    ensureAuditBackfillMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  it("retorna 401 quando não autenticado em todas as rotas", async () => {
    requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));

    expect((await GET()).status).toBe(401);
    expect(
      (
        await POST(
          jsonRequest("http://localhost/api/sector-goals", "POST", {
            assetClass: "BR_STOCK",
            name: "Bancos",
            targetPct: 25,
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await PATCH(
          jsonRequest("http://localhost/api/sector-goals/s1", "PATCH", {
            targetPct: 30,
          }),
          { params: Promise.resolve({ id: "s1" }) }
        )
      ).status
    ).toBe(401);
    expect(
      (
        await DELETE(new Request("http://localhost/api/sector-goals/s1"), {
          params: Promise.resolve({ id: "s1" }),
        })
      ).status
    ).toBe(401);
  });

  it("rejeita classe não-RV (ex: FIXED_INCOME) com 400", async () => {
    const res = await POST(
      jsonRequest("http://localhost/api/sector-goals", "POST", {
        assetClass: "FIXED_INCOME",
        name: "CDB",
        targetPct: 50,
      })
    );
    expect(res.status).toBe(400);
  });

  it("impede exclusão de setor com ativos vinculados retornando 409", async () => {
    prismaMock.sectorGoal.findFirst.mockResolvedValue({
      id: "sg-1",
      userId: USER_A.id,
      assetClass: "BR_STOCK",
      name: "Bancos",
      targetPct: 25,
    });
    prismaMock.asset.findMany.mockResolvedValue([
      { ticker: "ITUB4" },
      { ticker: "BBAS3" },
    ]);

    const res = await DELETE(
      new Request("http://localhost/api/sector-goals/sg-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "sg-1" }) }
    );

    expect(res.status).toBe(409);
    expect(txMock.sectorGoal.delete).not.toHaveBeenCalled();
  });

  it("retorna 404 ao tentar editar ou excluir setor de outro usuário (IDOR)", async () => {
    prismaMock.sectorGoal.findFirst.mockResolvedValue(null);

    const patchRes = await PATCH(
      jsonRequest("http://localhost/api/sector-goals/foreign", "PATCH", {
        name: "Energia",
      }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(patchRes.status).toBe(404);

    const delRes = await DELETE(
      new Request("http://localhost/api/sector-goals/foreign", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(delRes.status).toBe(404);
  });

  it("propaga renomeação do setor para os ativos do usuário na mesma transação", async () => {
    prismaMock.sectorGoal.findFirst.mockResolvedValue({
      id: "sg-1",
      userId: USER_A.id,
      assetClass: "BR_STOCK",
      name: "Bancos",
      targetPct: 25,
    });
    txMock.sectorGoal.update.mockResolvedValue({
      id: "sg-1",
      userId: USER_A.id,
      assetClass: "BR_STOCK",
      name: "Financeiro",
      targetPct: 25,
    });

    const res = await PATCH(
      jsonRequest("http://localhost/api/sector-goals/sg-1", "PATCH", {
        name: "Financeiro",
      }),
      { params: Promise.resolve({ id: "sg-1" }) }
    );

    expect(res.status).toBe(200);
    expect(txMock.asset.updateMany).toHaveBeenCalledWith({
      where: {
        userId: USER_A.id,
        assetClass: "BR_STOCK",
        sector: "Bancos",
      },
      data: { sector: "Financeiro" },
    });
  });
});
