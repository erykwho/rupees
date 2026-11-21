import { prisma } from "@/lib/prisma";
import { computeAssetPosition } from "@/lib/domain/calculations";
import {
  type BenchmarkRates,
  type FixedIncomeAssetClassKey,
  type FixedIncomeAssetInput,
  computeEffectiveContractedRate,
} from "@/lib/domain/fixed-income";
import { getFixedIncomeBenchmarks } from "@/lib/fixed-income-rates";
import type {
  FixedIncomeIndexKey,
  TransactionInput,
  TransactionTypeKey,
} from "@/lib/domain/types";

export interface FixedIncomeInitialData {
  assets: FixedIncomeAssetInput[];
  benchmarks: BenchmarkRates;
}

export async function loadUserFixedIncome(
  userId: string,
  options: { forceRefreshBenchmarks?: boolean } = {}
): Promise<FixedIncomeInitialData> {
  const [assetRows, txRows, benchmarks] = await Promise.all([
    prisma.asset.findMany({
      where: {
        userId,
        assetClass: { in: ["FIXED_INCOME", "EMERGENCY_RESERVE"] },
      },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    }),
    prisma.transaction.findMany({
      where: {
        userId,
        asset: {
          assetClass: { in: ["FIXED_INCOME", "EMERGENCY_RESERVE"] },
        },
      },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    getFixedIncomeBenchmarks({ forceRefresh: options.forceRefreshBenchmarks }),
  ]);

  const txByAsset = new Map<string, TransactionInput[]>();
  for (const t of txRows) {
    const item: TransactionInput = {
      id: t.id,
      assetId: t.assetId,
      date: t.date,
      type: t.type as TransactionTypeKey,
      quantity: Number(t.quantity),
      unitPrice: Number(t.unitPrice),
      totalAmount: Number(t.totalAmount),
      fixedIncomeRate:
        t.fixedIncomeRate !== null ? Number(t.fixedIncomeRate) : null,
      notes: t.notes,
    };
    const list = txByAsset.get(t.assetId);
    if (list) list.push(item);
    else txByAsset.set(t.assetId, [item]);
  }

  const assets: FixedIncomeAssetInput[] = assetRows.map((a) => {
    const txs = txByAsset.get(a.id) ?? [];
    const pos = computeAssetPosition(txs);
    const manualPrice = a.manualPrice !== null ? Number(a.manualPrice) : 1;
    const currentValueBRL = pos.quantity * manualPrice;
    const investedCostBRL = pos.investedCost;
    const assetDefaultRate =
      a.fixedIncomeRate !== null ? Number(a.fixedIncomeRate) : null;
    const {
      effectiveRate,
      hasLotRateOverride,
      lotsWithRateCount,
      firstBuyDate,
    } = computeEffectiveContractedRate(assetDefaultRate, txs);

    return {
      id: a.id,
      ticker: a.ticker,
      assetClass: a.assetClass as FixedIncomeAssetClassKey,
      sector: a.sector,
      isActive: a.isActive,
      currentValueBRL,
      investedCostBRL,
      fixedIncomeIndex: (a.fixedIncomeIndex as FixedIncomeIndexKey | null) ?? null,
      fixedIncomeRate: assetDefaultRate,
      maturityDate: a.maturityDate
        ? a.maturityDate.toISOString().slice(0, 10)
        : null,
      taxExempt: a.taxExempt,
      firstBuyDate,
      effectiveContractedRate: effectiveRate,
      hasLotRateOverride,
      lotsWithRateCount,
    };
  });

  return {
    assets,
    benchmarks,
  };
}
