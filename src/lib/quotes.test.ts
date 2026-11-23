import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  prismaMock,
  yahooQuoteMock,
  scheduleBackgroundWorkMock,
} = vi.hoisted(() => ({
  prismaMock: {
    quoteCache: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    asset: {
      updateMany: vi.fn(),
    },
  },
  yahooQuoteMock: vi.fn(),
  scheduleBackgroundWorkMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/background-work", () => ({
  scheduleBackgroundWork: scheduleBackgroundWorkMock,
}));
vi.mock("yahoo-finance2", () => ({
  default: class MockYahooFinance {
    quote = yahooQuoteMock;
  },
}));

import { getQuotesForAssets } from "@/lib/quotes";

describe("getQuotesForAssets (SWR & cache behavior)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleBackgroundWorkMock.mockReturnValue(true);
  });

  it("returns fresh cached quotes immediately without calling Yahoo or scheduling background work", async () => {
    const recent = new Date(Date.now() - 2 * 60 * 1000);
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "USDBRL=X", price: 5.2, currency: "BRL", updatedAt: recent },
      { symbol: "ITUB4.SA", price: 35.5, currency: "BRL", updatedAt: recent },
    ]);

    const res = await getQuotesForAssets([
      {
        id: "a1",
        ticker: "ITUB4",
        assetClass: "BR_STOCK",
        priceMode: "AUTO_YAHOO",
        tickerValidationStatus: "VERIFIED",
      },
    ]);

    expect(yahooQuoteMock).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).not.toHaveBeenCalled();
    expect(res.hasStaleQuotes).toBe(false);
    expect(res.usdBrl).toBe(5.2);
    expect(res.quotes["ITUB4.SA"]?.price).toBe(35.5);
  });

  it("serves expired cached quotes immediately (SWR) and schedules background refresh without blocking SSR", async () => {
    const expired = new Date(Date.now() - 30 * 60 * 1000);
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "USDBRL=X", price: 5.1, currency: "BRL", updatedAt: expired },
      { symbol: "ITUB4.SA", price: 34.0, currency: "BRL", updatedAt: expired },
    ]);

    const res = await getQuotesForAssets([
      {
        id: "a1",
        ticker: "ITUB4",
        assetClass: "BR_STOCK",
        priceMode: "AUTO_YAHOO",
        tickerValidationStatus: "VERIFIED",
      },
    ]);

    expect(yahooQuoteMock).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).toHaveBeenCalledTimes(1);
    expect(res.hasStaleQuotes).toBe(true);
    expect(res.quotes["ITUB4.SA"]?.price).toBe(34.0);
  });

  it("does not block SSR for unverified (INVALID / PENDING) tickers with no cache row", async () => {
    const recent = new Date(Date.now() - 60 * 1000);
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "USDBRL=X", price: 5.3, currency: "BRL", updatedAt: recent },
    ]);

    const res = await getQuotesForAssets([
      {
        id: "a-invalid",
        ticker: "FAKE99",
        assetClass: "BR_STOCK",
        priceMode: "AUTO_YAHOO",
        tickerValidationStatus: "INVALID",
      },
    ]);

    expect(yahooQuoteMock).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).toHaveBeenCalledTimes(1);
    expect(res.hasStaleQuotes).toBe(true);
    expect(res.updatedStatuses["a-invalid"]).toBe("INVALID");
  });

  it("fetches synchronously on cold cache miss for VERIFIED assets", async () => {
    const recent = new Date();
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "USDBRL=X", price: 5.3, currency: "BRL", updatedAt: recent },
    ]);
    yahooQuoteMock.mockResolvedValue([
      {
        symbol: "WEGE3.SA",
        exchange: "SAO",
        currency: "BRL",
        regularMarketPrice: 52.4,
      },
    ]);
    prismaMock.quoteCache.upsert.mockResolvedValue({
      symbol: "WEGE3.SA",
      price: 52.4,
      currency: "BRL",
      updatedAt: recent,
    });

    const res = await getQuotesForAssets([
      {
        id: "a2",
        ticker: "WEGE3",
        assetClass: "BR_STOCK",
        priceMode: "AUTO_YAHOO",
        tickerValidationStatus: "VERIFIED",
      },
    ]);

    expect(yahooQuoteMock).toHaveBeenCalledWith(["WEGE3.SA"]);
    expect(res.refreshedCount).toBe(1);
    expect(res.quotes["WEGE3.SA"]?.price).toBe(52.4);
  });

  it("fetches all symbols synchronously when forceRefresh is true", async () => {
    const recent = new Date();
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "USDBRL=X", price: 5.1, currency: "BRL", updatedAt: recent },
      { symbol: "ITUB4.SA", price: 34.0, currency: "BRL", updatedAt: recent },
    ]);
    yahooQuoteMock.mockResolvedValue([
      { symbol: "USDBRL=X", currency: "BRL", regularMarketPrice: 5.4 },
      {
        symbol: "ITUB4.SA",
        exchange: "SAO",
        currency: "BRL",
        regularMarketPrice: 36.2,
      },
    ]);
    prismaMock.quoteCache.upsert.mockImplementation(
      async ({ create }: { create: { symbol: string; price: number; currency: string } }) => ({
        ...create,
        updatedAt: new Date(),
      })
    );

    const res = await getQuotesForAssets(
      [
        {
          id: "a1",
          ticker: "ITUB4",
          assetClass: "BR_STOCK",
          priceMode: "AUTO_YAHOO",
          tickerValidationStatus: "VERIFIED",
        },
      ],
      { forceRefresh: true }
    );

    expect(yahooQuoteMock).toHaveBeenCalledTimes(1);
    expect(scheduleBackgroundWorkMock).not.toHaveBeenCalled();
    expect(res.refreshedCount).toBe(2);
    expect(res.quotes["ITUB4.SA"]?.price).toBe(36.2);
    expect(res.usdBrl).toBe(5.4);
  });
});
