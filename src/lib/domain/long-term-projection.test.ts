import { describe, expect, it } from "vitest";
import {
  ALL_ASSET_CLASSES,
  type AssetClassKey,
} from "./types";
import { type EvolutionDayPoint, addDaysISO } from "./evolution";
import {
  computeLongTermProjection,
  computeRealAnnualRatePct,
  extractProjectionBaseline,
} from "./long-term-projection";

function makeDayPoint(
  date: string,
  overrides: Partial<
    Record<
      AssetClassKey,
      { marketValueBRL: number; investedCostBRL?: number; netContributionBRL?: number }
    >
  >
): EvolutionDayPoint {
  const byClass = {} as EvolutionDayPoint["byClass"];
  for (const cls of ALL_ASSET_CLASSES) {
    const o = overrides[cls];
    byClass[cls] = {
      marketValueBRL: o?.marketValueBRL ?? 0,
      investedCostBRL: o?.investedCostBRL ?? o?.marketValueBRL ?? 0,
      netContributionBRL: o?.netContributionBRL ?? 0,
    };
  }
  return {
    date,
    usdBrl: 5.5,
    byClass,
  };
}

describe("computeRealAnnualRatePct", () => {
  it("applies exact Fisher equation", () => {
    // (1.10 / 1.045) - 1 = 0.0526315789...
    expect(computeRealAnnualRatePct(10, 4.5)).toBeCloseTo(5.2632, 3);
  });

  it("returns 0 when nominal return equals inflation", () => {
    expect(computeRealAnnualRatePct(5, 5)).toBeCloseTo(0, 6);
  });

  it("returns negative real rate when inflation exceeds nominal return", () => {
    expect(computeRealAnnualRatePct(4, 6)).toBeLessThan(0);
  });
});

describe("extractProjectionBaseline", () => {
  it("returns safe defaults for empty history", () => {
    const baseline = extractProjectionBaseline([]);
    expect(baseline.currentValueBRL).toBe(0);
    expect(baseline.averageMonthlyContribution).toEqual({ 3: 0, 6: 0, 12: 0 });
    expect(baseline.defaultAnnualReturnPct).toBe(10);
    expect(baseline.usedFallbackReturn).toBe(true);
    expect(baseline.fallbackReason).toBe("short_history");
  });

  it("excludes incomplete current month from average contributions and respects reserve toggle", () => {
    const points: EvolutionDayPoint[] = [
      // Jan 2026: R$ 1000 invested, R$ 500 reserve
      makeDayPoint("2026-01-15", {
        BR_STOCK: { marketValueBRL: 1000, netContributionBRL: 1000 },
        EMERGENCY_RESERVE: { marketValueBRL: 500, netContributionBRL: 500 },
      }),
      // Feb 2026: R$ 2000 invested
      makeDayPoint("2026-02-15", {
        BR_STOCK: { marketValueBRL: 3000, netContributionBRL: 2000 },
        EMERGENCY_RESERVE: { marketValueBRL: 500, netContributionBRL: 0 },
      }),
      // Mar 2026: R$ 3000 invested, R$ 1000 reserve
      makeDayPoint("2026-03-15", {
        BR_STOCK: { marketValueBRL: 6000, netContributionBRL: 3000 },
        EMERGENCY_RESERVE: { marketValueBRL: 1500, netContributionBRL: 1000 },
      }),
      // Apr 2026 (incomplete month - 10th of April): R$ 0 so far
      makeDayPoint("2026-04-10", {
        BR_STOCK: { marketValueBRL: 6200, netContributionBRL: 0 },
        EMERGENCY_RESERVE: { marketValueBRL: 1550, netContributionBRL: 0 },
      }),
    ];

    const withoutReserve = extractProjectionBaseline(points, {
      includeReserve: false,
    });
    expect(withoutReserve.currentValueBRL).toBe(6200);
    expect(withoutReserve.investedOnlyValueBRL).toBe(6200);
    expect(withoutReserve.reserveValueBRL).toBe(1550);
    expect(withoutReserve.closedMonthsAvailable).toBe(3);
    // Average of Jan(1000), Feb(2000), Mar(3000) = 2000 (Apr excluded!)
    expect(withoutReserve.averageMonthlyContribution[3]).toBe(2000);
    expect(withoutReserve.averageMonthlyContribution[6]).toBe(2000);
    expect(withoutReserve.monthsUsedByWindow[6]).toBe(3);

    const withReserve = extractProjectionBaseline(points, {
      includeReserve: true,
    });
    expect(withReserve.currentValueBRL).toBe(7750);
    // Jan(1500), Feb(2000), Mar(4000) -> avg = 2500
    expect(withReserve.averageMonthlyContribution[3]).toBe(2500);
  });

  it("computes annualized TWR accurately even with mid-period contributions", () => {
    // 1-year daily series compounding at exactly 12% a.a., with a R$ 5,000 contribution on day 180
    const startISO = "2025-01-01";
    const dailyRate = Math.pow(1.12, 1 / 365) - 1;
    const points: EvolutionDayPoint[] = [];
    let val = 10_000;

    for (let d = 0; d <= 365; d++) {
      const date = addDaysISO(startISO, d);
      let contrib = 0;
      if (d === 0) {
        contrib = 10_000;
      } else {
        val = val * (1 + dailyRate);
        if (d === 180) {
          contrib = 5_000;
          val += contrib;
        }
      }
      points.push(
        makeDayPoint(date, {
          BR_STOCK: {
            marketValueBRL: val,
            netContributionBRL: contrib,
          },
        })
      );
    }

    const baseline = extractProjectionBaseline(points);
    expect(baseline.usedFallbackReturn).toBe(false);
    expect(baseline.fallbackReason).toBe("none");
    expect(baseline.historicalAnnualReturnPct).toBeCloseTo(12, 1);
    expect(baseline.defaultAnnualReturnPct).toBeCloseTo(12, 1);
  });

  it("falls back to 10% a.a. when historical return is negative", () => {
    const startISO = "2025-01-01";
    const dailyRate = Math.pow(0.92, 1 / 365) - 1;
    const points: EvolutionDayPoint[] = [];
    let val = 10_000;

    for (let d = 0; d <= 180; d++) {
      const date = addDaysISO(startISO, d);
      if (d > 0) val = val * (1 + dailyRate);
      points.push(
        makeDayPoint(date, {
          BR_STOCK: {
            marketValueBRL: val,
            netContributionBRL: d === 0 ? 10_000 : 0,
          },
        })
      );
    }

    const baseline = extractProjectionBaseline(points);
    expect(baseline.historicalAnnualReturnPct).toBeLessThan(0);
    expect(baseline.usedFallbackReturn).toBe(true);
    expect(baseline.fallbackReason).toBe("non_positive");
    expect(baseline.defaultAnnualReturnPct).toBe(10);
  });
});

describe("computeLongTermProjection", () => {
  it("matches nominal and real values when inflation is 0%", () => {
    const res = computeLongTermProjection({
      initialValueBRL: 50_000,
      monthlyContributionBRL: 2_000,
      annualReturnPct: 10,
      annualInflationPct: 0,
      horizonYears: 10,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    expect(res.summary.finalRealBRL).toBe(res.summary.finalNominalBRL);
    expect(res.summary.totalContributedRealBRL).toBe(50_000 + 2_000 * 120);
    expect(res.summary.totalContributedNominalBRL).toBe(50_000 + 2_000 * 120);
    expect(res.summary.realAnnualReturnPct).toBe(10);
    expect(res.summary.purchasingPowerLossPct).toBe(0);
    expect(res.yearlyRows).toHaveLength(10);
  });

  it("keeps real contributed amount constant when adjustContributionForInflation is true", () => {
    const res = computeLongTermProjection({
      initialValueBRL: 100_000,
      monthlyContributionBRL: 3_000,
      annualReturnPct: 11,
      annualInflationPct: 4.5,
      horizonYears: 20,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    // In real terms, total contributed = initial + 240 * 3000 = 820,000
    expect(res.summary.totalContributedRealBRL).toBeCloseTo(820_000, 0);
    // In nominal terms, contributions grew with inflation so nominal > real
    expect(res.summary.totalContributedNominalBRL).toBeGreaterThan(820_000);
    expect(res.summary.finalNominalBRL).toBeGreaterThan(res.summary.finalRealBRL);
    // Real balance should exceed total real contributed since real return > 0
    expect(res.summary.finalRealBRL).toBeGreaterThan(820_000);
    expect(res.summary.estimatedMonthlyPassiveIncomeRealBRL).toBeGreaterThan(0);
    expect(res.points).toHaveLength(21); // Year 0..20
    expect(res.yearlyRows).toHaveLength(20);
  });

  it("erodes real contribution value when adjustContributionForInflation is false", () => {
    const adjusted = computeLongTermProjection({
      initialValueBRL: 50_000,
      monthlyContributionBRL: 2_000,
      annualReturnPct: 10,
      annualInflationPct: 5,
      horizonYears: 20,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    const fixedNominal = computeLongTermProjection({
      initialValueBRL: 50_000,
      monthlyContributionBRL: 2_000,
      annualReturnPct: 10,
      annualInflationPct: 5,
      horizonYears: 20,
      adjustContributionForInflation: false,
      startDateISO: "2026-01-01",
    });

    expect(fixedNominal.summary.totalContributedNominalBRL).toBeCloseTo(
      50_000 + 2_000 * 240,
      0
    );
    expect(fixedNominal.summary.totalContributedRealBRL).toBeLessThan(
      adjusted.summary.totalContributedRealBRL
    );
    expect(fixedNominal.summary.finalRealBRL).toBeLessThan(
      adjusted.summary.finalRealBRL
    );
  });

  it("returns 0 real passive income when inflation exceeds return", () => {
    const res = computeLongTermProjection({
      initialValueBRL: 100_000,
      monthlyContributionBRL: 1_000,
      annualReturnPct: 4,
      annualInflationPct: 6,
      horizonYears: 10,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    expect(res.summary.realAnnualReturnPct).toBeLessThan(0);
    expect(res.summary.estimatedMonthlyPassiveIncomeRealBRL).toBe(0);
    expect(res.summary.totalInterestRealBRL).toBeLessThan(0);
  });

  it("tracks real purchasing power milestones above initial value", () => {
    const res = computeLongTermProjection({
      initialValueBRL: 150_000,
      monthlyContributionBRL: 5_000,
      annualReturnPct: 11,
      annualInflationPct: 4.5,
      horizonYears: 20,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    // R$ 100k already passed at start, so first milestone should be R$ 250k
    expect(res.milestones.length).toBeGreaterThan(0);
    expect(res.milestones[0].targetBRL).toBe(250_000);
    expect(res.milestones.some((m) => m.targetBRL === 1_000_000)).toBe(true);
  });

  it("uses monthly sampling for short horizons (<= 2 years)", () => {
    const res = computeLongTermProjection({
      initialValueBRL: 10_000,
      monthlyContributionBRL: 1_000,
      annualReturnPct: 10,
      annualInflationPct: 4,
      horizonYears: 2,
      adjustContributionForInflation: true,
      startDateISO: "2026-01-01",
    });

    // Month 0..24 = 25 points
    expect(res.points).toHaveLength(25);
    expect(res.yearlyRows).toHaveLength(2);
  });
});
