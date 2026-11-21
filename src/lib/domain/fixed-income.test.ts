import { describe, expect, it } from "vitest";
import {
  type BenchmarkRates,
  type FixedIncomeAssetInput,
  computeAnnualGrossRatePct,
  computeEffectiveContractedRate,
  computeFixedIncomeProjection,
  formatFixedIncomeRate,
  getRegressiveIrRate,
  suggestFixedIncomeConfig,
} from "./fixed-income";
import type { TransactionInput } from "./types";

const BENCHMARKS: BenchmarkRates = {
  selic: 14.25,
  cdi: 14.15,
  ipca: 5.0,
  updatedAt: "2026-01-01T12:00:00.000Z",
  source: "bcb",
};

describe("getRegressiveIrRate", () => {
  it("returns 0 when asset is tax exempt", () => {
    expect(getRegressiveIrRate(10, true)).toBe(0);
    expect(getRegressiveIrRate(1000, true)).toBe(0);
  });

  it("applies the Brazilian regressive IR brackets accurately", () => {
    expect(getRegressiveIrRate(0, false)).toBe(0.225);
    expect(getRegressiveIrRate(180, false)).toBe(0.225);
    expect(getRegressiveIrRate(181, false)).toBe(0.2);
    expect(getRegressiveIrRate(360, false)).toBe(0.2);
    expect(getRegressiveIrRate(361, false)).toBe(0.175);
    expect(getRegressiveIrRate(720, false)).toBe(0.175);
    expect(getRegressiveIrRate(721, false)).toBe(0.15);
  });
});

describe("computeAnnualGrossRatePct", () => {
  it("calculates annual gross rates for all supported indexers", () => {
    expect(computeAnnualGrossRatePct("CDI_PCT", 100, BENCHMARKS)).toBeCloseTo(
      14.15,
      2
    );
    expect(computeAnnualGrossRatePct("CDI_PCT", 110, BENCHMARKS)).toBeCloseTo(
      15.565,
      2
    );
    expect(computeAnnualGrossRatePct("CDI_PLUS", 2, BENCHMARKS)).toBeCloseTo(
      ((1.1415 * 1.02) - 1) * 100,
      2
    );
    expect(computeAnnualGrossRatePct("SELIC_PCT", 100, BENCHMARKS)).toBeCloseTo(
      14.25,
      2
    );
    expect(computeAnnualGrossRatePct("SELIC_PLUS", 0.1, BENCHMARKS)).toBeCloseTo(
      ((1.1425 * 1.001) - 1) * 100,
      2
    );
    expect(computeAnnualGrossRatePct("IPCA_PLUS", 6.5, BENCHMARKS)).toBeCloseTo(
      ((1.05 * 1.065) - 1) * 100,
      2
    );
    expect(computeAnnualGrossRatePct("PREFIXED", 13.2, BENCHMARKS)).toBe(13.2);
  });
});

describe("computeEffectiveContractedRate", () => {
  it("falls back to asset default rate when no BUY lot overrides rate", () => {
    const txs: TransactionInput[] = [
      {
        id: "t1",
        assetId: "a1",
        date: "2024-03-10",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
      {
        id: "t2",
        assetId: "a1",
        date: "2024-06-10",
        type: "BALANCE_ADJUSTMENT",
        quantity: 50,
        unitPrice: 1,
        totalAmount: 50,
      },
    ];
    const res = computeEffectiveContractedRate(6.5, txs);
    expect(res.effectiveRate).toBe(6.5);
    expect(res.hasLotRateOverride).toBe(false);
    expect(res.lotsWithRateCount).toBe(0);
    expect(res.firstBuyDate).toBe("2024-03-10");
  });

  it("computes amount-weighted contracted rate across BUY lots, falling back to asset default for unrated lots", () => {
    const txs: TransactionInput[] = [
      {
        id: "t1",
        assetId: "a1",
        date: "2024-01-10",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
        fixedIncomeRate: 6.0,
      },
      {
        id: "t2",
        assetId: "a1",
        date: "2025-01-10",
        type: "BUY",
        quantity: 3000,
        unitPrice: 1,
        totalAmount: 3000,
        fixedIncomeRate: 7.0,
      },
      {
        id: "t3",
        assetId: "a1",
        date: "2025-06-10",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
        fixedIncomeRate: null, // uses default 6.5
      },
    ];
    const res = computeEffectiveContractedRate(6.5, txs);
    // (1000*6 + 3000*7 + 1000*6.5) / 5000 = 33500 / 5000 = 6.7
    expect(res.effectiveRate).toBeCloseTo(6.7, 4);
    expect(res.hasLotRateOverride).toBe(true);
    expect(res.lotsWithRateCount).toBe(2);
    expect(res.firstBuyDate).toBe("2024-01-10");
  });
});

describe("suggestFixedIncomeConfig & formatFixedIncomeRate", () => {
  it("suggests smart defaults based on ticker and assetClass", () => {
    expect(suggestFixedIncomeConfig("IPCA+ 2050", "FIXED_INCOME")).toEqual({
      fixedIncomeIndex: "IPCA_PLUS",
      fixedIncomeRate: 6.5,
      maturityDate: "2050-08-15",
      taxExempt: false,
    });
    expect(suggestFixedIncomeConfig("SELIC", "EMERGENCY_RESERVE")).toEqual({
      fixedIncomeIndex: "SELIC_PCT",
      fixedIncomeRate: 100,
      maturityDate: "",
      taxExempt: false,
    });
    expect(suggestFixedIncomeConfig("LCA-BB", "FIXED_INCOME")).toEqual({
      fixedIncomeIndex: "CDI_PCT",
      fixedIncomeRate: 90,
      maturityDate: "",
      taxExempt: true,
    });
  });

  it("formats contracted rate labels cleanly", () => {
    expect(formatFixedIncomeRate("CDI_PCT", 100)).toBe("100% CDI");
    expect(formatFixedIncomeRate("IPCA_PLUS", 6.5)).toBe("IPCA + 6,50%");
    expect(formatFixedIncomeRate("PREFIXED", 12)).toBe("12,00% a.a.");
    expect(formatFixedIncomeRate(null, null)).toBe("Não configurado");
  });
});

describe("computeFixedIncomeProjection", () => {
  const sampleAssets: FixedIncomeAssetInput[] = [
    {
      id: "fi-1",
      ticker: "IPCA+ 2028",
      assetClass: "FIXED_INCOME",
      sector: "Tesouro Direto",
      isActive: true,
      currentValueBRL: 10000,
      investedCostBRL: 9000,
      fixedIncomeIndex: "PREFIXED",
      fixedIncomeRate: 10,
      maturityDate: "2027-01-01", // 1 year from refDate 2026-01-01
      taxExempt: false,
      firstBuyDate: "2023-01-01", // > 720 days => 15% IR
      effectiveContractedRate: 10,
      hasLotRateOverride: false,
      lotsWithRateCount: 0,
    },
    {
      id: "er-1",
      ticker: "SELIC",
      assetClass: "EMERGENCY_RESERVE",
      sector: "Reserva",
      isActive: true,
      currentValueBRL: 5000,
      investedCostBRL: 5000,
      fixedIncomeIndex: "SELIC_PCT",
      fixedIncomeRate: 100,
      maturityDate: null,
      taxExempt: false,
      firstBuyDate: "2025-12-01", // < 180 days => 22.5% initially
      effectiveContractedRate: 100,
      hasLotRateOverride: false,
      lotsWithRateCount: 0,
    },
    {
      id: "fi-unconfigured",
      ticker: "CDB-NOVO",
      assetClass: "FIXED_INCOME",
      sector: "Bancário",
      isActive: true,
      currentValueBRL: 2000,
      investedCostBRL: 2000,
      fixedIncomeIndex: null,
      fixedIncomeRate: null,
      maturityDate: null,
      taxExempt: false,
      firstBuyDate: "2025-12-01",
      effectiveContractedRate: null,
      hasLotRateOverride: false,
      lotsWithRateCount: 0,
    },
  ];

  it("separates FIXED_INCOME and EMERGENCY_RESERVE totals and tracks unconfigured assets", () => {
    const res = computeFixedIncomeProjection({
      assets: sampleAssets,
      benchmarks: BENCHMARKS,
      horizon: "1A",
      scope: "FIXED_INCOME",
      referenceDate: "2026-01-01",
    });

    expect(res.unconfiguredAssets.map((a) => a.ticker)).toEqual(["CDB-NOVO"]);
    expect(res.fixedIncomeTotals.totalValueBRL).toBe(12000);
    expect(res.fixedIncomeTotals.configuredValueBRL).toBe(10000);
    expect(res.fixedIncomeTotals.unconfiguredCount).toBe(1);
    expect(res.fixedIncomeTotals.annualGrossBRL).toBeCloseTo(1000, 1);
    // Holding > 720 days => 15% IR => net gain ~850
    expect(res.fixedIncomeTotals.annualNetBRL).toBeCloseTo(850, 1);

    expect(res.emergencyReserveTotals.totalValueBRL).toBe(5000);
    expect(res.emergencyReserveTotals.annualGrossBRL).toBeCloseTo(712.5, 1);
  });

  it("freezes asset balance after maturity date instead of continuing to accrue yield", () => {
    const res = computeFixedIncomeProjection({
      assets: [sampleAssets[0]], // matures 2027-01-01 (12 months from 2026-01-01)
      benchmarks: BENCHMARKS,
      horizon: "2A", // 24 months
      scope: "FIXED_INCOME",
      monthlyContributionBRL: 500,
      referenceDate: "2026-01-01",
    });

    const atMaturity = res.series[12];
    const afterMaturity = res.series[18];
    const atEnd = res.series[24];

    expect(atMaturity.maturedTickers).toContain("IPCA+ 2028");
    expect(afterMaturity.grossValueBRL).toBe(atMaturity.grossValueBRL);
    expect(afterMaturity.netValueBRL).toBe(atMaturity.netValueBRL);
    expect(atEnd.grossValueBRL).toBe(atMaturity.grossValueBRL);
    expect(atEnd.netValueBRL).toBe(atMaturity.netValueBRL);
    // Principal also stops receiving simulated monthly contributions once matured
    expect(atEnd.principalBRL).toBe(atMaturity.principalBRL);
  });

  it("accumulates simulated monthly contributions proportionally on open assets", () => {
    const res = computeFixedIncomeProjection({
      assets: [sampleAssets[1]], // SELIC, no maturity, 5000 initial
      benchmarks: BENCHMARKS,
      horizon: "1A",
      scope: "EMERGENCY_RESERVE",
      monthlyContributionBRL: 1000,
      referenceDate: "2026-01-01",
    });

    // 5000 initial + 12 * 1000 = 17000 principal
    expect(res.finalPoint.principalBRL).toBe(17000);
    expect(res.finalPoint.grossValueBRL).toBeGreaterThan(17000);
    expect(res.finalPoint.netValueBRL).toBeGreaterThan(17000);
    expect(res.finalPoint.netValueBRL).toBeLessThan(res.finalPoint.grossValueBRL);
  });
});
