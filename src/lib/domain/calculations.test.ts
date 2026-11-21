import { describe, expect, it } from "vitest";
import {
  computeAssetPosition,
  computeContributionPlan,
  computeDerivedClassTargets,
  computeHierarchyForGoal,
  computeNextRebalanceAssets,
  computePortfolioSummary,
} from "./calculations";
import type { AssetInput, GoalInput, TransactionInput } from "./types";

const DEFAULT_GOAL: GoalInput = {
  fixedIncomePct: 10,
  variableIncomePct: 90,
  brazilPct: 60,
  usaPct: 40,
  brStocksPct: 70,
  brFiisPct: 30,
  usStocksPct: 70,
  usReitsPct: 30,
};

describe("computeDerivedClassTargets", () => {
  it("matches the Rupees spreadsheet hierarchy math", () => {
    const targets = computeDerivedClassTargets(DEFAULT_GOAL);
    expect(targets.FIXED_INCOME).toBe(10);
    expect(targets.BR_STOCK).toBe(37.8);
    expect(targets.BR_FII).toBe(16.2);
    expect(targets.US_STOCK).toBe(25.2);
    expect(targets.US_REIT).toBe(10.8);
    const sum = Object.values(targets).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 2);
  });
});

describe("computeAssetPosition", () => {
  it("computes weighted average cost across buys, partial sells, and full sells", () => {
    const txs: TransactionInput[] = [
      { id: "1", assetId: "a1", date: "2025-02-07", type: "BUY", quantity: 10, unitPrice: 10, totalAmount: 100 },
      { id: "2", assetId: "a1", date: "2025-03-01", type: "BUY", quantity: 10, unitPrice: 20, totalAmount: 200 },
      { id: "3", assetId: "a1", date: "2025-04-01", type: "SELL", quantity: 5, unitPrice: 25, totalAmount: 125 },
    ];
    const pos = computeAssetPosition(txs);
    expect(pos.quantity).toBe(15);
    expect(pos.avgPrice).toBeCloseTo(15, 4);
    expect(pos.investedCost).toBeCloseTo(225, 4);

    // Full sell resets quantity and avgPrice to 0
    const fullSell = computeAssetPosition([
      ...txs,
      { id: "4", assetId: "a1", date: "2025-05-01", type: "SELL", quantity: 15, unitPrice: 30, totalAmount: 450 },
    ]);
    expect(fullSell.quantity).toBe(0);
    expect(fullSell.avgPrice).toBe(0);
  });

  it("handles BALANCE_ADJUSTMENT for fixed income yield without changing cost basis", () => {
    const txs: TransactionInput[] = [
      { id: "1", assetId: "fi1", date: "2025-01-01", type: "BUY", quantity: 1000, unitPrice: 1, totalAmount: 1000 },
      { id: "2", assetId: "fi1", date: "2025-06-01", type: "BALANCE_ADJUSTMENT", quantity: 50, unitPrice: 1, totalAmount: 50 },
    ];
    const pos = computeAssetPosition(txs);
    expect(pos.quantity).toBe(1050);
    expect(pos.avgPrice).toBe(1);
  });
});

describe("computePortfolioSummary & computeContributionPlan", () => {
  const assets: AssetInput[] = [
    { id: "fi", ticker: "IPCA", assetClass: "FIXED_INCOME", sector: "Tesouro", currency: "BRL", targetPctInClass: 100, priceMode: "MANUAL", manualPrice: 1, isActive: true },
    { id: "res", ticker: "SELIC", assetClass: "EMERGENCY_RESERVE", sector: "Reserva", currency: "BRL", targetPctInClass: 100, priceMode: "MANUAL", manualPrice: 1, isActive: true },
    { id: "brs", ticker: "WEGE3", assetClass: "BR_STOCK", sector: "Indústria", currency: "BRL", targetPctInClass: 100, priceMode: "AUTO_YAHOO", manualPrice: null, isActive: true },
    { id: "fii", ticker: "KNRI11", assetClass: "BR_FII", sector: "Híbrido", currency: "BRL", targetPctInClass: 100, priceMode: "AUTO_YAHOO", manualPrice: null, isActive: true },
    { id: "uss", ticker: "VOO", assetClass: "US_STOCK", sector: "S&P 500", currency: "USD", targetPctInClass: 100, priceMode: "AUTO_YAHOO", manualPrice: null, isActive: true },
    { id: "usr", ticker: "VNQ", assetClass: "US_REIT", sector: "Real Estate", currency: "USD", targetPctInClass: 100, priceMode: "AUTO_YAHOO", manualPrice: null, isActive: true },
  ];

  const transactions: TransactionInput[] = [
    { id: "t1", assetId: "fi", date: "2025-01-01", type: "BUY", quantity: 1000, unitPrice: 1, totalAmount: 1000 },
    { id: "t2", assetId: "res", date: "2025-01-01", type: "BUY", quantity: 5000, unitPrice: 1, totalAmount: 5000 },
    { id: "t3", assetId: "brs", date: "2025-01-01", type: "BUY", quantity: 40, unitPrice: 50, totalAmount: 2000 },
    { id: "t4", assetId: "uss", date: "2025-01-01", type: "BUY", quantity: 1, unitPrice: 500, totalAmount: 500 },
  ];

  const quotes = {
    "WEGE3.SA": { price: 50, updatedAt: "2026-01-01T00:00:00.000Z" },
    "KNRI11.SA": { price: 140, updatedAt: "2026-01-01T00:00:00.000Z" },
    VOO: { price: 600, updatedAt: "2026-01-01T00:00:00.000Z" },
    VNQ: { price: 100, updatedAt: "2026-01-01T00:00:00.000Z" },
  };

  it("separates emergency reserve from invested total and converts USD to BRL", () => {
    const summary = computePortfolioSummary({
      assets,
      transactions,
      goal: DEFAULT_GOAL,
      quotes,
      usdBrl: 5,
    });

    // IPCA (1000) + WEGE3 (40*50=2000) + VOO (1*600*5=3000) = 6000
    expect(summary.totalInvestedValueBRL).toBeCloseTo(6000, 2);
    expect(summary.emergencyReserveBRL).toBeCloseTo(5000, 2);
    expect(summary.grandTotalBRL).toBeCloseTo(11000, 2);
    // VOO cost was 500*5 = 2500, current = 3000 -> +500 profit
    expect(summary.totalProfitLossBRL).toBeCloseTo(500, 2);
  });

  it("suggests integer shares for B3 and respects fractional rules for US/Fixed Income", () => {
    const summary = computePortfolioSummary({
      assets,
      transactions,
      goal: DEFAULT_GOAL,
      quotes,
      usdBrl: 5,
    });

    const plan = computeContributionPlan({
      summary,
      amountBRL: 1000,
      maxAssets: 3,
    });

    expect(plan.totalAllocatedBRL).toBeLessThanOrEqual(1000);
    expect(plan.suggestions.length).toBeGreaterThan(0);
    for (const s of plan.suggestions) {
      if (s.assetClass === "BR_STOCK" || s.assetClass === "BR_FII") {
        expect(Number.isInteger(s.suggestedQty)).toBe(true);
      }
    }
  });

  it("prioritizes top 3 rebalance assets by class deficit first, then asset deficit, excluding emergency reserve", () => {
    const summary = computePortfolioSummary({
      assets,
      transactions,
      goal: DEFAULT_GOAL,
      quotes,
      usdBrl: 5,
    });

    // Total invested = 6000
    // Targets: FI=600 (actual 1000, diff -400), BR_STOCK=2268 (actual 2000, need +268),
    // BR_FII=972 (actual 0, need +972), US_STOCK=1512 (actual 3000, diff -1488), US_REIT=648 (actual 0, need +648)
    // Priority order should be: KNRI11 (BR_FII, +972), VNQ (US_REIT, +648), WEGE3 (BR_STOCK, +268)
    const nextAssets = computeNextRebalanceAssets(summary, 3);
    expect(nextAssets.map((a) => a.ticker)).toEqual(["KNRI11", "VNQ", "WEGE3"]);
    expect(nextAssets.every((a) => a.assetClass !== "EMERGENCY_RESERVE")).toBe(true);
  });

  it("recomputes hierarchy live when goal percentages change", () => {
    const summary = computePortfolioSummary({
      assets,
      transactions,
      goal: DEFAULT_GOAL,
      quotes,
      usdBrl: 5,
    });

    const updatedGoal: GoalInput = {
      ...DEFAULT_GOAL,
      fixedIncomePct: 30,
      variableIncomePct: 70,
      brazilPct: 50,
      usaPct: 50,
    };

    const liveHierarchy = computeHierarchyForGoal(updatedGoal, summary.classes);
    const fiRow = liveHierarchy.find((r) => r.key === "FIXED_INCOME");
    const brRow = liveHierarchy.find((r) => r.key === "BRAZIL");

    expect(fiRow?.targetPct).toBe(30);
    // actual FI = 1000 / 6000 = 16.67%
    expect(fiRow?.actualPct).toBeCloseTo(16.67, 1);
    expect(fiRow?.diffPct).toBeCloseTo(16.67 - 30, 1);

    expect(brRow?.targetPct).toBe(50);
    // actual BR inside RV = 2000 / 5000 = 40%
    expect(brRow?.actualPct).toBeCloseTo(40, 1);
    expect(brRow?.diffPct).toBeCloseTo(-10, 1);
  });
});
