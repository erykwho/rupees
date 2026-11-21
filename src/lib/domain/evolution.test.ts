import { describe, expect, it } from "vitest";
import {
  aggregateEvolutionView,
  computePortfolioEvolution,
} from "./evolution";
import type { AssetInput, TransactionInput } from "./types";

const baseAssets: AssetInput[] = [
  {
    id: "a-petr",
    ticker: "PETR4",
    assetClass: "BR_STOCK",
    sector: "Petróleo",
    currency: "BRL",
    targetPctInClass: 100,
    priceMode: "AUTO_YAHOO",
    manualPrice: null,
    isActive: true,
  },
  {
    id: "a-vti",
    ticker: "VTI",
    assetClass: "US_STOCK",
    sector: "ETF",
    currency: "USD",
    targetPctInClass: 100,
    priceMode: "AUTO_YAHOO",
    manualPrice: null,
    isActive: true,
  },
  {
    id: "a-cdb",
    ticker: "CDB",
    assetClass: "FIXED_INCOME",
    sector: "Renda Fixa",
    currency: "BRL",
    targetPctInClass: 100,
    priceMode: "MANUAL",
    manualPrice: 1,
    isActive: true,
  },
  {
    id: "a-selic",
    ticker: "SELIC",
    assetClass: "EMERGENCY_RESERVE",
    sector: "Reserva",
    currency: "BRL",
    targetPctInClass: 0,
    priceMode: "MANUAL",
    manualPrice: 1,
    isActive: true,
  },
];

describe("computePortfolioEvolution", () => {
  it("returns empty series when there are no transactions", () => {
    const res = computePortfolioEvolution({
      assets: baseAssets,
      transactions: [],
      historicalPrices: {},
      currentQuotes: {},
      currentUsdBrl: 5.5,
      todayISO: "2026-03-10",
    });
    expect(res.points).toEqual([]);
    expect(res.firstTransactionDate).toBeNull();
  });

  it("replays daily positions with historical prices, FX carry-forward, and BALANCE_ADJUSTMENT excluded from contributions", () => {
    const transactions: TransactionInput[] = [
      // 2026-01-02 (Friday): Buy 100 PETR4 @ 30, 10 VTI @ 100 USD, 1000 CDB, 500 SELIC
      {
        id: "t1",
        assetId: "a-petr",
        date: "2026-01-02",
        type: "BUY",
        quantity: 100,
        unitPrice: 30,
        totalAmount: 3000,
      },
      {
        id: "t2",
        assetId: "a-vti",
        date: "2026-01-02",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        totalAmount: 1000,
      },
      {
        id: "t3",
        assetId: "a-cdb",
        date: "2026-01-02",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
      {
        id: "t4",
        assetId: "a-selic",
        date: "2026-01-02",
        type: "BUY",
        quantity: 500,
        unitPrice: 1,
        totalAmount: 500,
      },
      // 2026-01-05 (Monday): CDB yield +50 via BALANCE_ADJUSTMENT (should NOT be counted as contribution)
      {
        id: "t5",
        assetId: "a-cdb",
        date: "2026-01-05",
        type: "BALANCE_ADJUSTMENT",
        quantity: 50,
        unitPrice: 1,
        totalAmount: 50,
      },
      // 2026-01-06 (Tuesday): Sell 20 PETR4 @ 35
      {
        id: "t6",
        assetId: "a-petr",
        date: "2026-01-06",
        type: "SELL",
        quantity: 20,
        unitPrice: 35,
        totalAmount: 700,
      },
    ];

    const historicalPrices = {
      "PETR4.SA": {
        "2026-01-02": 32,
        // 2026-01-05 missing -> carry-forward 32
        "2026-01-06": 35,
      },
      VTI: {
        "2026-01-02": 105,
        "2026-01-05": 110,
      },
      "USDBRL=X": {
        "2026-01-02": 5.0,
        "2026-01-05": 5.2,
      },
    };

    const currentQuotes = {
      "PETR4.SA": { price: 36, updatedAt: "2026-01-07T15:00:00Z" },
      VTI: { price: 112, updatedAt: "2026-01-07T15:00:00Z" },
    };

    const evo = computePortfolioEvolution({
      assets: baseAssets,
      transactions,
      historicalPrices,
      currentQuotes,
      currentUsdBrl: 5.5,
      todayISO: "2026-01-07",
    });

    // Emitted weekdays: Jan 2 (Fri), Jan 5 (Mon), Jan 6 (Tue), Jan 7 (Wed = today)
    expect(evo.points.map((p) => p.date)).toEqual([
      "2026-01-02",
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
    ]);

    const jan2 = evo.points[0];
    expect(jan2.byClass.BR_STOCK).toEqual({
      marketValueBRL: 3200,
      investedCostBRL: 3000,
      netContributionBRL: 3000,
    });
    expect(jan2.byClass.US_STOCK).toEqual({
      marketValueBRL: 5250, // 10 * 105 * 5.0
      investedCostBRL: 5000, // 10 * 100 * 5.0
      netContributionBRL: 5000,
    });
    expect(jan2.byClass.EMERGENCY_RESERVE.marketValueBRL).toBe(500);

    // Jan 5: CDB yield +50 increases marketValue to 1050, cost stays 1000, contribution is 0
    const jan5 = evo.points[1];
    expect(jan5.byClass.FIXED_INCOME).toEqual({
      marketValueBRL: 1050,
      investedCostBRL: 1000,
      netContributionBRL: 0,
    });
    // PETR4 carries forward 32
    expect(jan5.byClass.BR_STOCK.marketValueBRL).toBe(3200);
    // VTI updated to 110 * 5.2 = 5720
    expect(jan5.byClass.US_STOCK.marketValueBRL).toBe(5720);

    // Jan 6: Sold 20 PETR4 @ 35 -> qty 80, avgPrice 30, cost 2400, market 80*35=2800, contrib -700
    const jan6 = evo.points[2];
    expect(jan6.byClass.BR_STOCK).toEqual({
      marketValueBRL: 2800,
      investedCostBRL: 2400,
      netContributionBRL: -700,
    });

    // Jan 7 (today): uses currentQuotes & currentUsdBrl (5.5)
    const jan7 = evo.points[3];
    expect(jan7.usdBrl).toBe(5.5);
    expect(jan7.byClass.BR_STOCK.marketValueBRL).toBe(2880); // 80 * 36
    expect(jan7.byClass.US_STOCK.marketValueBRL).toBe(6160); // 10 * 112 * 5.5
  });
});

describe("aggregateEvolutionView", () => {
  const transactions: TransactionInput[] = [
    {
      id: "t1",
      assetId: "a-petr",
      date: "2025-11-10",
      type: "BUY",
      quantity: 100,
      unitPrice: 30,
      totalAmount: 3000,
    },
    {
      id: "t2",
      assetId: "a-selic",
      date: "2025-11-10",
      type: "BUY",
      quantity: 2000,
      unitPrice: 1,
      totalAmount: 2000,
    },
    {
      id: "t3",
      assetId: "a-cdb",
      date: "2026-01-15",
      type: "BUY",
      quantity: 1000,
      unitPrice: 1,
      totalAmount: 1000,
    },
  ];

  const evo = computePortfolioEvolution({
    assets: baseAssets,
    transactions,
    historicalPrices: {
      "PETR4.SA": {
        "2025-11-10": 30,
        "2025-12-30": 33,
        "2026-01-15": 35,
      },
    },
    currentQuotes: {
      "PETR4.SA": { price: 36, updatedAt: "2026-01-20T15:00:00Z" },
    },
    currentUsdBrl: 5.5,
    todayISO: "2026-01-20",
  });

  it("excludes emergency reserve from Total by default and includes when toggled", () => {
    const withoutReserve = aggregateEvolutionView(evo.points, {
      selectedClasses: [],
      includeReserve: false,
      range: "ALL",
      granularity: "MONTHLY",
      contributionGrouping: "MONTHLY",
    });

    // PETR4 (3600) + CDB (1000) = 4600
    expect(withoutReserve.kpis.currentMarketValueBRL).toBe(4600);
    expect(withoutReserve.kpis.totalInvestedCostBRL).toBe(4000);
    expect(withoutReserve.kpis.totalProfitLossBRL).toBe(600);
    expect(withoutReserve.kpis.totalProfitLossPct).toBe(15);
    expect(withoutReserve.evolutionSeries.length).toBe(3); // Nov, Dec, Jan

    const lastPt = withoutReserve.evolutionSeries[2];
    expect(lastPt.classMarketValue.BR_STOCK).toBe(3600);
    expect(lastPt.classMarketValue.FIXED_INCOME).toBe(1000);
    expect(lastPt.classProfitLoss.BR_STOCK).toBe(600);
    expect(lastPt.classProfitLossPct.BR_STOCK).toBe(20);

    const withReserve = aggregateEvolutionView(evo.points, {
      selectedClasses: [],
      includeReserve: true,
      range: "ALL",
      granularity: "MONTHLY",
      contributionGrouping: "MONTHLY",
    });

    // + 2000 SELIC
    expect(withReserve.kpis.currentMarketValueBRL).toBe(6600);
    expect(withReserve.kpis.totalInvestedCostBRL).toBe(6000);
  });

  it("supports multi-select class filtering and daily contribution grouping", () => {
    const onlyStocks = aggregateEvolutionView(evo.points, {
      selectedClasses: ["BR_STOCK"],
      includeReserve: false,
      range: "ALL",
      granularity: "DAILY",
      contributionGrouping: "DAILY",
    });

    expect(onlyStocks.activeClasses).toEqual(["BR_STOCK"]);
    expect(onlyStocks.kpis.currentMarketValueBRL).toBe(3600);
    expect(onlyStocks.contributionSeries).toHaveLength(1);
    expect(onlyStocks.contributionSeries[0].key).toBe("2025-11-10");
    expect(onlyStocks.contributionSeries[0].BR_STOCK).toBe(3000);
  });

  it("computes sub-period KPIs (YTD) while preserving cumulative chart values", () => {
    const ytd = aggregateEvolutionView(evo.points, {
      selectedClasses: [],
      includeReserve: false,
      range: "YTD",
      granularity: "DAILY",
      contributionGrouping: "MONTHLY",
    });

    expect(ytd.kpis.isSubPeriod).toBe(true);
    // Baseline at end of 2025: PETR4 = 3300, CDB = 0 -> 3300
    // In 2026: contributed 1000 (CDB), ended at 4600 (PETR4 3600 + CDB 1000)
    // Period gain = 4600 - 3300 - 1000 = 300
    expect(ytd.kpis.periodContributionBRL).toBe(1000);
    expect(ytd.kpis.periodGainBRL).toBe(300);
    expect(ytd.kpis.totalProfitLossBRL).toBe(600);
    expect(ytd.evolutionSeries[0].date >= "2026-01-01").toBe(true);
  });
});

describe("computePortfolioEvolution — estimated fixed income (net of IR)", () => {
  const defaultRates = {
    selicAnnualPct: { "2025-01-01": 10 },
    cdiAnnualPct: { "2025-01-01": 10 },
    ipcaMonthlyPct: { "2025-01": 1.0 },
    fallback: { selic: 10, cdi: 10, ipca: 5 },
  };

  it("accrues daily net-of-IR yield for configured FIXED_INCOME and EMERGENCY_RESERVE and respects taxExempt", () => {
    const assets: AssetInput[] = [
      {
        id: "cdb",
        ticker: "CDB 100%",
        assetClass: "FIXED_INCOME",
        sector: "Renda Fixa",
        currency: "BRL",
        targetPctInClass: 50,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "CDI_PCT",
        fixedIncomeRate: 100,
        taxExempt: false,
      },
      {
        id: "lci",
        ticker: "LCI 100%",
        assetClass: "FIXED_INCOME",
        sector: "Renda Fixa",
        currency: "BRL",
        targetPctInClass: 50,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "CDI_PCT",
        fixedIncomeRate: 100,
        taxExempt: true,
      },
      {
        id: "selic",
        ticker: "SELIC",
        assetClass: "EMERGENCY_RESERVE",
        sector: "Reserva",
        currency: "BRL",
        targetPctInClass: 100,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "SELIC_PCT",
        fixedIncomeRate: 100,
        taxExempt: false,
      },
    ];

    const transactions: TransactionInput[] = [
      {
        id: "t1",
        assetId: "cdb",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
      {
        id: "t2",
        assetId: "lci",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
      {
        id: "t3",
        assetId: "selic",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
    ];

    // Exactly 365 days later: 2026-01-01
    // At 10% a.a. for 365 days:
    // - LCI (taxExempt): gross = 1100, net = 1100 (+100)
    // - CDB (365 days -> 17.5% IR): gross gain = 100, net gain = 82.50 -> 1082.50
    // - SELIC (365 days -> 17.5% IR): net = 1082.50
    const evo = computePortfolioEvolution({
      assets,
      transactions,
      historicalPrices: {},
      currentQuotes: {},
      currentUsdBrl: 5.5,
      todayISO: "2026-01-01",
      fixedIncomeRates: defaultRates,
    });

    expect(evo.hasEstimatedFixedIncome).toBe(true);

    // Day 0: zero gain
    expect(evo.points[0].byClass.FIXED_INCOME.marketValueBRL).toBe(2000);
    expect(evo.points[0].byClass.EMERGENCY_RESERVE.marketValueBRL).toBe(1000);

    // Final day (365 days elapsed):
    const last = evo.points[evo.points.length - 1];
    expect(last.date).toBe("2026-01-01");
    expect(last.byClass.FIXED_INCOME.investedCostBRL).toBe(2000);
    expect(last.byClass.FIXED_INCOME.marketValueBRL).toBeCloseTo(2182.5, 1);
    expect(last.byClass.EMERGENCY_RESERVE.investedCostBRL).toBe(1000);
    expect(last.byClass.EMERGENCY_RESERVE.marketValueBRL).toBeCloseTo(1082.5, 1);

    // Aggregated KPIs and Rentabilidade (%) reflect the estimated net gain
    const agg = aggregateEvolutionView(evo.points, {
      selectedClasses: ["FIXED_INCOME"],
      includeReserve: false,
      range: "ALL",
      granularity: "MONTHLY",
      contributionGrouping: "MONTHLY",
    });
    expect(agg.kpis.totalProfitLossBRL).toBeCloseTo(182.5, 1);
    expect(agg.kpis.totalProfitLossPct).toBeCloseTo(9.13, 1);
  });

  it("anchors balance on BALANCE_ADJUSTMENT without duplicating gain and resumes accruing afterward", () => {
    const assets: AssetInput[] = [
      {
        id: "cdb",
        ticker: "CDB",
        assetClass: "FIXED_INCOME",
        sector: "Renda Fixa",
        currency: "BRL",
        targetPctInClass: 100,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "PREFIXED",
        fixedIncomeRate: 12,
        taxExempt: true,
      },
    ];

    const transactions: TransactionInput[] = [
      {
        id: "t1",
        assetId: "cdb",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
      // After 30 days, user records exact real yield of +25 -> real balance = 1025
      {
        id: "t2",
        assetId: "cdb",
        date: "2025-01-31",
        type: "BALANCE_ADJUSTMENT",
        quantity: 25,
        unitPrice: 1,
        totalAmount: 25,
      },
    ];

    const evo = computePortfolioEvolution({
      assets,
      transactions,
      historicalPrices: {},
      currentQuotes: {},
      currentUsdBrl: 5.5,
      todayISO: "2025-03-02", // 30 days after anchor
      fixedIncomeRates: defaultRates,
    });

    const anchorPoint = evo.points.find((p) => p.date === "2025-01-31")!;
    expect(anchorPoint.byClass.FIXED_INCOME.marketValueBRL).toBe(1025);
    expect(anchorPoint.byClass.FIXED_INCOME.investedCostBRL).toBe(1000);

    // 30 days after anchor: 1025 * (1.12)^(30/365) ~= 1034.59
    const last = evo.points[evo.points.length - 1];
    expect(last.date).toBe("2025-03-02");
    expect(last.byClass.FIXED_INCOME.marketValueBRL).toBeCloseTo(1034.59, 1);
    expect(last.byClass.FIXED_INCOME.investedCostBRL).toBe(1000);
  });

  it("freezes accrual after maturityDate and supports per-lot rate override and FIFO sells", () => {
    const assets: AssetInput[] = [
      {
        id: "pre",
        ticker: "TESOURO PRE",
        assetClass: "FIXED_INCOME",
        sector: "Tesouro",
        currency: "BRL",
        targetPctInClass: 100,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "PREFIXED",
        fixedIncomeRate: 10,
        maturityDate: "2025-07-01",
        taxExempt: true,
      },
    ];

    const transactions: TransactionInput[] = [
      {
        id: "t1",
        assetId: "pre",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
        fixedIncomeRate: 20, // Lot-specific override
      },
    ];

    const evo = computePortfolioEvolution({
      assets,
      transactions,
      historicalPrices: {},
      currentQuotes: {},
      currentUsdBrl: 5.5,
      todayISO: "2025-12-31",
      fixedIncomeRates: defaultRates,
    });

    const atMaturity = evo.points.find((p) => p.date === "2025-07-01")!;
    const afterMaturity = evo.points[evo.points.length - 1];

    // Accrued at 20% a.a. for 181 days (~9.46% -> ~1094.6), then frozen until Dec 31
    expect(atMaturity.byClass.FIXED_INCOME.marketValueBRL).toBeGreaterThan(1090);
    expect(afterMaturity.byClass.FIXED_INCOME.marketValueBRL).toBe(
      atMaturity.byClass.FIXED_INCOME.marketValueBRL
    );
  });

  it("applies historical monthly IPCA for IPCA_PLUS assets", () => {
    const assets: AssetInput[] = [
      {
        id: "ipca",
        ticker: "IPCA+ 6%",
        assetClass: "FIXED_INCOME",
        sector: "Tesouro",
        currency: "BRL",
        targetPctInClass: 100,
        priceMode: "MANUAL",
        manualPrice: 1,
        isActive: true,
        fixedIncomeIndex: "IPCA_PLUS",
        fixedIncomeRate: 0, // Pure IPCA test
        taxExempt: true,
      },
    ];

    const transactions: TransactionInput[] = [
      {
        id: "t1",
        assetId: "ipca",
        date: "2025-01-01",
        type: "BUY",
        quantity: 1000,
        unitPrice: 1,
        totalAmount: 1000,
      },
    ];

    // January 2025 has 31 days with 1.0% monthly IPCA -> by 2025-02-01 (31 days elapsed, 30 days in Jan + 1 day in Feb)
    const evo = computePortfolioEvolution({
      assets,
      transactions,
      historicalPrices: {},
      currentQuotes: {},
      currentUsdBrl: 5.5,
      todayISO: "2025-01-31", // 30 days elapsed in Jan (30/31 of 1%)
      fixedIncomeRates: {
        selicAnnualPct: {},
        cdiAnnualPct: {},
        ipcaMonthlyPct: { "2025-01": 1.0 },
        fallback: { selic: 10, cdi: 10, ipca: 5 },
      },
    });

    const jan31 = evo.points[evo.points.length - 1];
    // 1000 * (1.01)^(30/31) ~= 1009.68
    expect(jan31.byClass.FIXED_INCOME.marketValueBRL).toBeCloseTo(1009.68, 1);
  });
});
