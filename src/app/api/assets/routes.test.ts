import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  validateTickerOnYahooMock,
  ensureAuditBackfillMock,
  recordAuditEventMock,
  prismaMock,
  txMock,
} = vi.hoisted(() => {
  const tx = {
    sectorGoal: { upsert: vi.fn() },
    asset: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    transaction: { findMany: vi.fn() },
  };
  return {
    requireUserMock: vi.fn(),
    validateTickerOnYahooMock: vi.fn(),
    ensureAuditBackfillMock: vi.fn(),
    recordAuditEventMock: vi.fn(),
    txMock: tx,
    prismaMock: {
      asset: {
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
vi.mock("@/lib/ticker-validator", () => ({
  validateTickerOnYahoo: validateTickerOnYahooMock,
}));
vi.mock("@/lib/audit-service", () => ({
  ensureAuditBackfill: ensureAuditBackfillMock,
  recordAuditEvent: recordAuditEventMock,
  toAssetSnapshot: vi.fn((a) => ({ id: a.id, ticker: a.ticker })),
  toTransactionSnapshot: vi.fn((t) => ({ id: t.id })),
}));

import { GET, POST } from "@/app/api/assets/route";
import { PATCH, DELETE } from "@/app/api/assets/[id]/route";

const USER_A = { id: "user-a", email: "a@example.com" };

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/assets/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    validateTickerOnYahooMock.mockResolvedValue({ status: "VERIFIED" });
    ensureAuditBackfillMock.mockResolvedValue(undefined);
    recordAuditEventMock.mockResolvedValue(undefined);
  });

  describe("Autenticação (401) e App Lock (423)", () => {
    it("retorna 401 quando não autenticado em GET, POST, PATCH e DELETE", async () => {
      requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));

      expect((await GET()).status).toBe(401);
      expect(
        (
          await POST(
            jsonRequest("http://localhost/api/assets", "POST", {
              ticker: "ITUB4",
              assetClass: "BR_STOCK",
            })
          )
        ).status
      ).toBe(401);
      expect(
        (
          await PATCH(
            jsonRequest("http://localhost/api/assets/a1", "PATCH", {
              sector: "Bancos",
            }),
            { params: Promise.resolve({ id: "a1" }) }
          )
        ).status
      ).toBe(401);
      expect(
        (
          await DELETE(new Request("http://localhost/api/assets/a1"), {
            params: Promise.resolve({ id: "a1" }),
          })
        ).status
      ).toBe(401);
    });

    it("retorna 423 quando o App Lock está ativo e bloqueado", async () => {
      requireUserMock.mockRejectedValue(new Error("APP_LOCKED"));
      expect((await GET()).status).toBe(423);
    });
  });

  describe("GET & POST /api/assets", () => {
    it("filtra listagem estritamente por userId", async () => {
      prismaMock.asset.findMany.mockResolvedValue([]);
      const res = await GET();
      expect(res.status).toBe(200);
      expect(prismaMock.asset.findMany).toHaveBeenCalledWith({
        where: { userId: USER_A.id },
        orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
      });
    });

    it("rejeita payload inválido com 400 (Zod)", async () => {
      const res = await POST(
        jsonRequest("http://localhost/api/assets", "POST", {
          ticker: "",
          assetClass: "INVALID_CLASS",
        })
      );
      expect(res.status).toBe(400);
    });

    it("rejeita ticker inválido no Yahoo Finance com 422", async () => {
      validateTickerOnYahooMock.mockResolvedValue({
        status: "INVALID",
        reason: "Ticker não encontrado na B3.",
      });

      const res = await POST(
        jsonRequest("http://localhost/api/assets", "POST", {
          ticker: "FAKE99",
          assetClass: "BR_STOCK",
        })
      );
      expect(res.status).toBe(422);
      expect(txMock.asset.create).not.toHaveBeenCalled();
    });

    it("retorna 503 quando Yahoo Finance está indisponível e allowUnverifiedOnUnavailable não foi enviado", async () => {
      validateTickerOnYahooMock.mockResolvedValue({
        status: "UNAVAILABLE",
      });

      const res = await POST(
        jsonRequest("http://localhost/api/assets", "POST", {
          ticker: "ITUB4",
          assetClass: "BR_STOCK",
        })
      );
      expect(res.status).toBe(503);
      expect(txMock.asset.create).not.toHaveBeenCalled();
    });

    it("cria ativo de renda fixa em BRL com priceMode MANUAL, manualPrice 1 e registra auditoria", async () => {
      txMock.asset.create.mockResolvedValue({
        id: "asset-rf",
        userId: USER_A.id,
        ticker: "TESOURO SELIC",
        assetClass: "FIXED_INCOME",
        currency: "BRL",
        priceMode: "MANUAL",
        manualPrice: 1,
      });

      const res = await POST(
        jsonRequest("http://localhost/api/assets", "POST", {
          ticker: "Tesouro Selic",
          assetClass: "FIXED_INCOME",
          targetPctInClass: 100,
        })
      );

      expect(res.status).toBe(201);
      expect(validateTickerOnYahooMock).not.toHaveBeenCalled();
      expect(txMock.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: USER_A.id,
            currency: "BRL",
            priceMode: "MANUAL",
            manualPrice: 1,
          }),
        })
      );
      expect(recordAuditEventMock).toHaveBeenCalledWith(
        txMock,
        expect.objectContaining({
          userId: USER_A.id,
          entityType: "ASSET",
          action: "CREATE",
        })
      );
    });
  });

  describe("PATCH & DELETE /api/assets/[id] (Proteção contra IDOR)", () => {
    it("retorna 404 ao tentar editar ativo de outro usuário", async () => {
      prismaMock.asset.findFirst.mockResolvedValue(null);

      const res = await PATCH(
        jsonRequest("http://localhost/api/assets/foreign-id", "PATCH", {
          sector: "Outro",
        }),
        { params: Promise.resolve({ id: "foreign-id" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-id", userId: USER_A.id },
      });
      expect(txMock.asset.update).not.toHaveBeenCalled();
    });

    it("retorna 404 ao tentar excluir ativo de outro usuário", async () => {
      prismaMock.asset.findFirst.mockResolvedValue(null);

      const res = await DELETE(
        new Request("http://localhost/api/assets/foreign-id", {
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: "foreign-id" }) }
      );

      expect(res.status).toBe(404);
      expect(prismaMock.asset.findFirst).toHaveBeenCalledWith({
        where: { id: "foreign-id", userId: USER_A.id },
      });
      expect(txMock.asset.delete).not.toHaveBeenCalled();
    });
  });
});
