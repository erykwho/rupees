import { describe, expect, it } from "vitest";
import { computePortfolioEvolution, aggregateEvolutionView } from "./evolution";
import {
  MAR_2025_US_REVERSAL_TARGETS,
  planMar2025ReversalCleanup,
  type CleanupAuditEventCandidate,
  type CleanupTransactionCandidate,
} from "./reversal-cleanup";
import type { AssetInput, TransactionInput } from "./types";

function makeTx(
  overrides: Partial<CleanupTransactionCandidate> & {
    id: string;
    ticker: string;
    date: string;
    type: "BUY" | "SELL";
    quantity: number;
    totalAmount: number;
  }
): CleanupTransactionCandidate {
  const unitPrice =
    overrides.unitPrice ??
    (overrides.quantity > 0 ? overrides.totalAmount / overrides.quantity : 0);
  return {
    assetId: overrides.assetId ?? `asset-${overrides.ticker}`,
    unitPrice,
    ...overrides,
  };
}

describe("planMar2025ReversalCleanup", () => {
  it("matches all 4 anomalous VOO and VNQ buy/reversal transactions and their audit events without touching valid trades", () => {
    const transactions: CleanupTransactionCandidate[] = [
      makeTx({
        id: "tx-voo-buy-bad",
        ticker: "VOO",
        date: "2025-03-03T12:00:00.000Z",
        type: "BUY",
        quantity: 0.15969,
        totalAmount: 500,
      }),
      makeTx({
        id: "tx-vnq-buy-bad",
        ticker: "VNQ",
        date: "2025-03-03T12:00:00.000Z",
        type: "BUY",
        quantity: 0.90279,
        totalAmount: 500,
      }),
      makeTx({
        id: "tx-voo-sell-bad",
        ticker: "VOO",
        date: "2025-03-06T12:00:00.000Z",
        type: "SELL",
        quantity: 0.15969,
        totalAmount: 500,
      }),
      makeTx({
        id: "tx-vnq-sell-bad",
        ticker: "VNQ",
        date: "2025-03-06T12:00:00.000Z",
        type: "SELL",
        quantity: 0.90279,
        totalAmount: 500,
      }),
      // Valid transactions that MUST NOT be matched
      makeTx({
        id: "tx-voo-buy-valid",
        ticker: "VOO",
        date: "2025-03-07T12:00:00.000Z",
        type: "BUY",
        quantity: 0.17637,
        totalAmount: 92.85,
      }),
      makeTx({
        id: "tx-vnq-buy-valid",
        ticker: "VNQ",
        date: "2025-03-31T12:00:00.000Z",
        type: "BUY",
        quantity: 1.43861,
        totalAmount: 130,
      }),
    ];

    const auditEvents: CleanupAuditEventCandidate[] = [
      {
        id: "ev-1",
        entityId: "tx-voo-buy-bad",
        entityLabel: "Compra VOO",
        action: "CREATE",
        createdAt: "2025-03-03T12:00:00.000Z",
      },
      {
        id: "ev-2",
        entityId: "tx-vnq-buy-bad",
        entityLabel: "Compra VNQ",
        action: "CREATE",
        createdAt: "2025-03-03T12:00:00.000Z",
      },
      {
        id: "ev-3",
        entityId: "tx-voo-sell-bad",
        entityLabel: "Venda VOO",
        action: "CREATE",
        createdAt: "2025-03-06T12:00:00.000Z",
      },
      {
        id: "ev-4",
        entityId: "tx-vnq-sell-bad",
        entityLabel: "Venda VNQ",
        action: "CREATE",
        createdAt: "2025-03-06T12:00:00.000Z",
      },
      {
        id: "ev-valid",
        entityId: "tx-voo-buy-valid",
        entityLabel: "Compra VOO",
        action: "CREATE",
        createdAt: "2025-03-07T12:00:00.000Z",
      },
    ];

    const plan = planMar2025ReversalCleanup({ transactions, auditEvents });

    expect(plan.matchedTransactions.map((m) => m.transaction.id)).toEqual([
      "tx-voo-buy-bad",
      "tx-voo-sell-bad",
      "tx-vnq-buy-bad",
      "tx-vnq-sell-bad",
    ]);
    expect(plan.missingTargets).toHaveLength(0);
    expect(plan.partialPairs).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.matchedAuditEvents.map((e) => e.id)).toEqual([
      "ev-1",
      "ev-2",
      "ev-3",
      "ev-4",
    ]);
  });

  it("is idempotent when anomalous transactions were already removed, and still cleans orphaned audit events by snapshot", () => {
    const plan = planMar2025ReversalCleanup({
      transactions: [
        makeTx({
          id: "tx-voo-buy-valid",
          ticker: "VOO",
          date: "2025-03-07T12:00:00.000Z",
          type: "BUY",
          quantity: 0.17637,
          totalAmount: 92.85,
        }),
      ],
      auditEvents: [
        {
          id: "ev-orphan",
          entityId: "deleted-tx-id",
          entityLabel: "Compra VOO",
          action: "CREATE",
          createdAt: "2025-03-03T12:00:00.000Z",
          snapshot: {
            ticker: "VOO",
            type: "BUY",
            dateISO: "2025-03-03",
            quantity: 0.15969,
            totalAmount: 500,
          },
        },
        {
          id: "ev-valid",
          entityId: "tx-voo-buy-valid",
          entityLabel: "Compra VOO",
          action: "CREATE",
          createdAt: "2025-03-07T12:00:00.000Z",
        },
      ],
    });

    expect(plan.matchedTransactions).toHaveLength(0);
    expect(plan.missingTargets).toHaveLength(MAR_2025_US_REVERSAL_TARGETS.length);
    expect(plan.partialPairs).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
    expect(plan.matchedAuditEvents.map((e) => e.id)).toEqual(["ev-orphan"]);
  });

  it("flags partialPairs when only one side of a BUY/SELL reversal pair exists", () => {
    const plan = planMar2025ReversalCleanup({
      transactions: [
        makeTx({
          id: "tx-voo-buy-only",
          ticker: "VOO",
          date: "2025-03-03T12:00:00.000Z",
          type: "BUY",
          quantity: 0.15969,
          totalAmount: 500,
        }),
      ],
      auditEvents: [],
    });

    expect(plan.matchedTransactions).toHaveLength(1);
    expect(plan.partialPairs).toEqual(["VOO-2025-03"]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it("eliminates the ~-83% US_STOCK and US_REIT return distortion between 2025-03-03 and 2025-03-05", () => {
    const assets: AssetInput[] = [
      {
        id: "asset-voo",
        ticker: "VOO",
        assetClass: "US_STOCK",
        sector: "ETF",
        currency: "USD",
        targetPctInClass: 100,
        priceMode: "AUTO_YAHOO",
        manualPrice: null,
        isActive: true,
      },
      {
        id: "asset-vnq",
        ticker: "VNQ",
        assetClass: "US_REIT",
        sector: "REIT",
        currency: "USD",
        targetPctInClass: 100,
        priceMode: "AUTO_YAHOO",
        manualPrice: null,
        isActive: true,
      },
    ];

    const allTx: TransactionInput[] = [
      {
        id: "tx-voo-buy-bad",
        assetId: "asset-voo",
        date: "2025-03-03T12:00:00.000Z",
        type: "BUY",
        quantity: 0.15969,
        unitPrice: 3131.066441,
        totalAmount: 500,
      },
      {
        id: "tx-vnq-buy-bad",
        assetId: "asset-vnq",
        date: "2025-03-03T12:00:00.000Z",
        type: "BUY",
        quantity: 0.90279,
        unitPrice: 553.838656,
        totalAmount: 500,
      },
      {
        id: "tx-voo-sell-bad",
        assetId: "asset-voo",
        date: "2025-03-06T12:00:00.000Z",
        type: "SELL",
        quantity: 0.15969,
        unitPrice: 3131.066441,
        totalAmount: 500,
      },
      {
        id: "tx-vnq-sell-bad",
        assetId: "asset-vnq",
        date: "2025-03-06T12:00:00.000Z",
        type: "SELL",
        quantity: 0.90279,
        unitPrice: 553.838656,
        totalAmount: 500,
      },
      {
        id: "tx-voo-buy-valid",
        assetId: "asset-voo",
        date: "2025-03-07T12:00:00.000Z",
        type: "BUY",
        quantity: 0.17637,
        unitPrice: 526.45,
        totalAmount: 92.85,
      },
    ];

    const historicalPrices: Record<string, Record<string, number>> = {
      "USDBRL=X": {
        "2025-03-03": 5.88,
        "2025-03-04": 5.89,
        "2025-03-05": 5.85,
        "2025-03-06": 5.76,
        "2025-03-07": 5.78,
      },
      VOO: {
        "2025-03-03": 537,
        "2025-03-04": 530,
        "2025-03-05": 536,
        "2025-03-06": 527,
        "2025-03-07": 529,
      },
      VNQ: {
        "2025-03-03": 92,
        "2025-03-04": 91.5,
        "2025-03-05": 92.2,
        "2025-03-06": 91,
        "2025-03-07": 91.5,
      },
    };

    const before = computePortfolioEvolution({
      assets,
      transactions: allTx,
      historicalPrices,
      currentQuotes: {},
      currentUsdBrl: 5.78,
      todayISO: "2025-03-07",
    });

    const beforeAgg = aggregateEvolutionView(before.points, {
      selectedClasses: ["US_STOCK"],
      includeReserve: false,
      range: "ALL",
      granularity: "DAILY",
      contributionGrouping: "DAILY",
    });

    const mar4Before = beforeAgg.evolutionSeries.find(
      (p) => p.date === "2025-03-04"
    );
    expect(mar4Before?.profitLossPct).toBeLessThan(-80);

    const plan = planMar2025ReversalCleanup({
      transactions: allTx.map((t) => ({
        ...t,
        ticker: t.assetId === "asset-voo" ? "VOO" : "VNQ",
      })),
      auditEvents: [],
    });
    const toRemove = new Set(plan.matchedTransactions.map((m) => m.transaction.id));
    const cleanedTx = allTx.filter((t) => !toRemove.has(t.id));

    const after = computePortfolioEvolution({
      assets,
      transactions: cleanedTx,
      historicalPrices,
      currentQuotes: {},
      currentUsdBrl: 5.78,
      todayISO: "2025-03-07",
    });

    const afterAgg = aggregateEvolutionView(after.points, {
      selectedClasses: ["US_STOCK"],
      includeReserve: false,
      range: "ALL",
      granularity: "DAILY",
      contributionGrouping: "DAILY",
    });

    expect(after.firstTransactionDate).toBe("2025-03-07");
    expect(afterAgg.evolutionSeries).toHaveLength(1);
    expect(afterAgg.evolutionSeries[0].profitLossPct).toBeGreaterThan(-5);
    expect(afterAgg.evolutionSeries[0].profitLossPct).toBeLessThan(5);
  });
});
