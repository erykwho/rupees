import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, scheduleBackgroundWorkMock } = vi.hoisted(() => ({
  prismaMock: {
    quoteCache: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    historicalQuoteSync: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    historicalQuoteCache: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  scheduleBackgroundWorkMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/background-work", () => ({
  scheduleBackgroundWork: scheduleBackgroundWorkMock,
}));

import {
  getFixedIncomeBenchmarks,
  getHistoricalFixedIncomeBenchmarks,
} from "@/lib/fixed-income-rates";

describe("fixed-income-rates (SWR, cooldown & parallel reads)", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleBackgroundWorkMock.mockReturnValue(true);
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("serves expired BCB benchmarks from cache immediately (SWR) and schedules background refresh", async () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "BCB:SELIC", price: 14.25, currency: "PCT", updatedAt: expired },
      { symbol: "BCB:CDI", price: 14.15, currency: "PCT", updatedAt: expired },
      { symbol: "BCB:IPCA12M", price: 4.8, currency: "PCT", updatedAt: expired },
    ]);

    const rates = await getFixedIncomeBenchmarks();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).toHaveBeenCalledTimes(1);
    expect(rates.source).toBe("cache");
    expect(rates.selic).toBe(14.25);
    expect(rates.cdi).toBe(14.15);
    expect(rates.ipca).toBe(4.8);
  });

  it("respects 6h sync cooldown on historical BCB series (prevents weekend/outage retry loops)", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago (< 6h cooldown)
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "BCB:SELIC", price: 14.25, currency: "PCT", updatedAt: recent },
      { symbol: "BCB:CDI", price: 14.15, currency: "PCT", updatedAt: recent },
      { symbol: "BCB:IPCA12M", price: 4.8, currency: "PCT", updatedAt: recent },
    ]);
    prismaMock.historicalQuoteSync.findMany.mockResolvedValue([
      {
        symbol: "BCB:HIST:SELIC",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20", // Older than endDate (2026-11-22 weekend)
        updatedAt: recent,
      },
      {
        symbol: "BCB:HIST:CDI",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20",
        updatedAt: recent,
      },
      {
        symbol: "BCB:HIST:IPCA",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20",
        updatedAt: recent,
      },
    ]);
    prismaMock.historicalQuoteCache.findMany.mockResolvedValue([
      { symbol: "BCB:HIST:CDI", date: "2026-11-20", closePrice: 14.15 },
    ]);

    const res = await getHistoricalFixedIncomeBenchmarks({
      startDate: "2025-01-01",
      endDate: "2026-11-22",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).not.toHaveBeenCalled();
    expect(res.hasStaleRates).toBe(false);
    expect(res.rates.cdiAnnualPct["2026-11-20"]).toBe(14.15);
    expect(res.benchmarks.cdi).toBe(14.15);
  });

  it("schedules background incremental sync when historical BCB series are past the 6h cooldown", async () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000);
    const oldSync = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8h ago (> 6h cooldown)
    prismaMock.quoteCache.findMany.mockResolvedValue([
      { symbol: "BCB:SELIC", price: 14.25, currency: "PCT", updatedAt: recent },
      { symbol: "BCB:CDI", price: 14.15, currency: "PCT", updatedAt: recent },
      { symbol: "BCB:IPCA12M", price: 4.8, currency: "PCT", updatedAt: recent },
    ]);
    prismaMock.historicalQuoteSync.findMany.mockResolvedValue([
      {
        symbol: "BCB:HIST:SELIC",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20",
        updatedAt: oldSync,
      },
      {
        symbol: "BCB:HIST:CDI",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20",
        updatedAt: oldSync,
      },
      {
        symbol: "BCB:HIST:IPCA",
        coveredFrom: "2024-01-01",
        coveredTo: "2026-11-20",
        updatedAt: oldSync,
      },
    ]);
    prismaMock.historicalQuoteCache.findMany.mockResolvedValue([
      { symbol: "BCB:HIST:SELIC", date: "2026-11-20", closePrice: 14.25 },
    ]);

    const res = await getHistoricalFixedIncomeBenchmarks({
      startDate: "2025-01-01",
      endDate: "2026-11-22",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(scheduleBackgroundWorkMock).toHaveBeenCalledTimes(1);
    expect(res.hasStaleRates).toBe(true);
    expect(res.rates.selicAnnualPct["2026-11-20"]).toBe(14.25);
  });
});
