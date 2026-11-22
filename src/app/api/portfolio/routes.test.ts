import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  loadUserPortfolioMock,
  loadUserEvolutionMock,
  loadUserFixedIncomeMock,
  listAuditEventsMock,
  revertAuditEventMock,
  searchTickersForClassMock,
  computeContributionPlanMock,
  MockRevertConflictError,
} = vi.hoisted(() => {
  class RevertConflictError extends Error {
    status: number;
    constructor(message: string, status = 409) {
      super(message);
      this.status = status;
    }
  }
  return {
    requireUserMock: vi.fn(),
    loadUserPortfolioMock: vi.fn(),
    loadUserEvolutionMock: vi.fn(),
    loadUserFixedIncomeMock: vi.fn(),
    listAuditEventsMock: vi.fn(),
    revertAuditEventMock: vi.fn(),
    searchTickersForClassMock: vi.fn(),
    computeContributionPlanMock: vi.fn(),
    MockRevertConflictError: RevertConflictError,
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

vi.mock("@/lib/portfolio-loader", () => ({
  loadUserPortfolio: loadUserPortfolioMock,
}));
vi.mock("@/lib/evolution-loader", () => ({
  loadUserEvolution: loadUserEvolutionMock,
}));
vi.mock("@/lib/fixed-income-loader", () => ({
  loadUserFixedIncome: loadUserFixedIncomeMock,
}));
vi.mock("@/lib/audit-service", () => ({
  listAuditEvents: listAuditEventsMock,
  revertAuditEvent: revertAuditEventMock,
  RevertConflictError: MockRevertConflictError,
}));
vi.mock("@/lib/ticker-validator", () => ({
  searchTickersForClass: searchTickersForClassMock,
}));
vi.mock("@/lib/domain/calculations", () => ({
  computeContributionPlan: computeContributionPlanMock,
}));

import { GET as getPortfolio } from "@/app/api/portfolio/route";
import { GET as getEvolution } from "@/app/api/evolution/route";
import { GET as getFixedIncome } from "@/app/api/fixed-income/route";
import { POST as postContributionPlan } from "@/app/api/contribution-plan/route";
import { GET as getEvents } from "@/app/api/events/route";
import { POST as postRevertEvent } from "@/app/api/events/[id]/revert/route";
import { GET as getTickersSearch } from "@/app/api/tickers/search/route";

const USER_A = { id: "user-a", email: "a@example.com" };

describe("API Analytics, Contribution Plan, Events & Tickers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
  });

  it("retorna 401 quando não autenticado em todas as rotas analíticas e auxiliares", async () => {
    requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));

    expect(
      (await getPortfolio(new Request("http://localhost/api/portfolio"))).status
    ).toBe(401);
    expect(
      (await getEvolution(new Request("http://localhost/api/evolution"))).status
    ).toBe(401);
    expect(
      (await getFixedIncome(new Request("http://localhost/api/fixed-income")))
        .status
    ).toBe(401);
    expect(
      (
        await postContributionPlan(
          new Request("http://localhost/api/contribution-plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amountBRL: 1000 }),
          })
        )
      ).status
    ).toBe(401);
    expect(
      (await getEvents(new Request("http://localhost/api/events"))).status
    ).toBe(401);
    expect(
      (
        await postRevertEvent(
          new Request("http://localhost/api/events/e1/revert", {
            method: "POST",
          }),
          { params: Promise.resolve({ id: "e1" }) }
        )
      ).status
    ).toBe(401);
    expect(
      (
        await getTickersSearch(
          new Request(
            "http://localhost/api/tickers/search?q=ITUB&assetClass=BR_STOCK"
          )
        )
      ).status
    ).toBe(401);
  });

  it("retorna 423 quando App Lock está bloqueado", async () => {
    requireUserMock.mockRejectedValue(new Error("APP_LOCKED"));
    expect(
      (await getPortfolio(new Request("http://localhost/api/portfolio"))).status
    ).toBe(423);
  });

  it("escopa chamadas de portfolio, evolution, fixed-income e events estritamente por userId", async () => {
    loadUserPortfolioMock.mockResolvedValue({ summary: {} });
    loadUserEvolutionMock.mockResolvedValue({ series: [] });
    loadUserFixedIncomeMock.mockResolvedValue({ items: [] });
    listAuditEventsMock.mockResolvedValue({ events: [], nextCursor: null });

    await getPortfolio(new Request("http://localhost/api/portfolio?refresh=1"));
    expect(loadUserPortfolioMock).toHaveBeenCalledWith(USER_A.id, {
      forceRefreshQuotes: true,
    });

    await getEvolution(new Request("http://localhost/api/evolution?refresh=1"));
    expect(loadUserEvolutionMock).toHaveBeenCalledWith(USER_A.id, {
      forceRefresh: true,
    });

    await getFixedIncome(
      new Request("http://localhost/api/fixed-income?refresh=true")
    );
    expect(loadUserFixedIncomeMock).toHaveBeenCalledWith(USER_A.id, {
      forceRefreshBenchmarks: true,
    });

    await getEvents(
      new Request("http://localhost/api/events?entityType=ASSET&action=CREATE")
    );
    expect(listAuditEventsMock).toHaveBeenCalledWith(
      USER_A.id,
      expect.objectContaining({
        entityType: "ASSET",
        action: "CREATE",
      })
    );
  });

  it("valida payload do /api/contribution-plan com Zod (400 em valor negativo ou maxAssets inválido)", async () => {
    const res = await postContributionPlan(
      new Request("http://localhost/api/contribution-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountBRL: -100, maxAssets: 0 }),
      })
    );
    expect(res.status).toBe(400);
    expect(loadUserPortfolioMock).not.toHaveBeenCalled();
  });

  it("propaga status de RevertConflictError em POST /api/events/[id]/revert", async () => {
    revertAuditEventMock.mockRejectedValue(
      new MockRevertConflictError("Evento não encontrado", 404)
    );

    const res = await postRevertEvent(
      new Request("http://localhost/api/events/foreign/revert", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "foreign" }) }
    );
    expect(res.status).toBe(404);
    expect(revertAuditEventMock).toHaveBeenCalledWith(USER_A.id, "foreign");
  });
});
