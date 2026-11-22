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
    transaction: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    requireUserMock: vi.fn(),
    ensureAuditBackfillMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      asset: { findFirst: vi.fn() },
      transaction: {
        findMany: vi.fn(),
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
vi.mock("@/lib/audit-service", () => ({
  ensureAuditBackfill: ensureAuditBackfillMock,
  recordAuditEvent: recordAuditEventMock,
  buildTransactionEntityLabel: vi.fn(() => "BUY ITUB4"),
  toTransactionSnapshot: vi.fn((t) => ({ id: t.id })),
}));

import { GET, POST } from "@/app/api/transactions/route";
import { PATCH, DELETE } from "@/app/api/transactions/[id]/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/transactions/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    ensureAuditBackfillMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  describe("Autenticação (401) e App Lock (423)", () => {
    it("retorna 401 quando não autenticado em todas as rotas de transações", async () => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));

      expect(
        (await GET(new Request("http://localhost/api/transactions"))).status
      ).toBe(401);
      expect(
        (
          await POST(
            jsonRequest("http://localhost/api/transactions", "POST", {
              assetId: "a1",
              date: "2026-01-10",
              quantity: 10,
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await PATCH(
            jsonRequest("http://localhost/api/transactions/t1", "PATCH", {
              quantity: 5,
            }),
            { params: Promise.resolve({ id: "t1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await DELETE(new Request("http://localhost/api/transactions/t1"), {
            params: Promise.resolve({ id: "t1" }),
          })
        ).status
      ).toBe(401);
    });

    it("retorna 423 quando App Lock está bloqueado", async () => {
      requireUserMock.mockRejectedValue(new Error("APP_LOCKED"));
      expect(
        (await GET(new Request("http://localhost/api/transactions"))).status
      ).toBe(423);
    });
  });

  describe("GET & POST /api/transactions", () => {
    it("filtra listagem estritamente por userId", async () => {
      prismaMock.transaction.findMany.mockResolvedValue([]);
      const res = await GET(
        new Request("http://localhost/api/transactions?assetId=asset-1")
      );
      expect(res.status).toBe(200);
      expect(prismaMock.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_A.id, assetId: "asset-1" },
        })
      );
    });

    it("rejeita quantidade zero com 400 (Zod)", async () => {
      const res = await POST(
        jsonRequest("http://localhost/api/transactions", "POST", {
          assetId: "a1",
          date: "2026-01-10",
          quantity: 0,
        })
      );
      expect(res.status).toBe(400);
    });

    it("rejeita criação de lançamento em ativo de outro usuário com 404 (IDOR)", async () => {
      prismaMock.asset.findFirst.mockResolvedValue(null);

      const res = await POST(
        jsonRequest("http://localhost/api/transactions", "POST", {
          assetId: "foreign-asset",
          date: "2026-01-10",
          type: "BUY",
          quantity: 10,
          unitPrice: 30,
        })
      );

      expect(res.status).toBe(404);
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-asset", userId: USER_A.id },
      });
      expect(txMock.transaction.create).not.toHaveBeenCalled();
    });

    it("força unitPrice=1 em BALANCE_ADJUSTMENT e preserva sinal negativo", async () => {
      prismaMock.asset.findFirst.mockResolvedValue({
        id: "rf-1",
        userId: USER_A.id,
        assetClass: "FIXED_INCOME",
      });
      txMock.transaction.create.mockResolvedValue({
        id: "tx-1",
        assetId: "rf-1",
        date: new Date("2026-01-10T12:00:00.000Z"),
        type: "BALANCE_ADJUSTMENT",
        quantity: -50,
        unitPrice: 1,
        totalAmount: -50,
        fixedIncomeRate: null,
        notes: "Ajuste",
        asset: {
          id: "rf-1",
          ticker: "CDB",
          assetClass: "FIXED_INCOME",
          currency: "BRL",
          sector: "Renda Fixa",
          fixedIncomeIndex: "CDI_PCT",
          fixedIncomeRate: 100,
        },
      });

      const res = await POST(
        jsonRequest("http://localhost/api/transactions", "POST", {
          assetId: "rf-1",
          date: "2026-01-10",
          type: "BALANCE_ADJUSTMENT",
          quantity: -50,
          totalAmount: -50,
        })
      );

      expect(res.status).toBe(201);
      expect(txMock.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A.id,
            quantity: -50,
            unitPrice: 1,
            totalAmount: -50,
          }),
        })
      );
    });
  });

  describe("PATCH & DELETE /api/transactions/[id] (Proteção contra IDOR)", () => {
    it("retorna 404 ao tentar reatribuir lançamento para assetId de outro usuário", async () => {
      prismaMock.transaction.findFirst.mockResolvedValue({
        id: "tx-a",
        userId: USER_A.id,
        assetId: "asset-a",
        date: new Date("2026-01-10T12:00:00.000Z"),
        type: "BUY",
        quantity: 10,
        unitPrice: 20,
        totalAmount: 200,
        fixedIncomeRate: null,
        notes: null,
        asset: { id: "asset-a" },
      });
      prismaMock.asset.findFirst.mockResolvedValue(null);

      const res = await PATCH(
        jsonRequest("http://localhost/api/transactions/tx-a", "PATCH", {
          assetId: "foreign-asset",
        }),
        { params: Promise.resolve({ id: "tx-a" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-asset", userId: USER_A.id },
        select: { id: true },
      });
      expect(txMock.transaction.update).not.toHaveBeenCalled();
    });

    it("retorna 404 ao tentar excluir lançamento de outro usuário", async () => {
      prismaMock.transaction.findFirst.mockResolvedValue(null);

      const res = await DELETE(
        new Request("http://localhost/api/transactions/foreign-tx", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "foreign-tx" }) }
      );

      expect(res.status).toBe(404);
      expect(txMock.transaction.delete).not.toHaveBeenCalled();
    });
  });
});
