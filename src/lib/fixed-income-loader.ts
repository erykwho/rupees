import { prisma } from "@/lib/prisma";
import { computeAssetPosition } from "@/lib/domain/calculations";
import {
  type BenchmarkRates,
  type FixedIncomeAssetClassKey,
  type FixedIncomeAssetInput,
  computeEffectiveContractedRate,
} from "@/lib/domain/fixed-income";
import { getFixedIncomeBenchmarks } from "@/lib/fixed-income-rates";
import { invalidateUserFinancialCaches } from "@/lib/server-cache";
import {
  type AssetInput,
  type FixedIncomeIndexKey,
  type TransactionInput,
  type TransactionTypeKey,
  isFixedIncomeClass,
} from "@/lib/domain/types";

export interface FixedIncomeInitialData {
  assets: FixedIncomeAssetInput[];
  benchmarks: BenchmarkRates;
}

/**
 * Pure builder that derives FixedIncomeInitialData from already-fetched
 * assets, transactions, and benchmark rates (avoids duplicate DB queries on /evolucao).
 */
export function buildFixedIncomeDataFromInputs(params: {
  assets: AssetInput[];
  transactions: TransactionInput[];
  benchmarks: BenchmarkRates;
}): FixedIncomeInitialData {
  const { assets: allAssets, transactions, benchmarks } = params;

  const fiAssets = allAssets.filter((a) => isFixedIncomeClass(a.assetClass));
  const fiAssetIds = new Set(fiAssets.map((a) => a.id));

  const txByAsset = new Map<string, TransactionInput[]>();
  for (const item of transactions) {
    if (!fiAssetIds.has(item.assetId)) continue;
    const list = txByAsset.get(item.assetId);
    if (list) list.push(item);
    else txByAsset.set(item.assetId, [item]);
  }

  const assets: FixedIncomeAssetInput[] = fiAssets.map((a) => {
    const txs = txByAsset.get(a.id) ?? [];
    const pos = computeAssetPosition(txs);
    const manualPrice = a.manualPrice !== null ? Number(a.manualPrice) : 1;
    const currentValueBRL = pos.quantity * manualPrice;
    const investedCostBRL = pos.investedCost;
    const assetDefaultRate =
      a.fixedIncomeRate !== null && a.fixedIncomeRate !== undefined
        ? Number(a.fixedIncomeRate)
        : null;
    const {
      effectiveRate,
      hasLotRateOverride,
      lotsWithRateCount,
      firstBuyDate,
    } = computeEffectiveContractedRate(assetDefaultRate, txs);

    const maturityDate =
      typeof a.maturityDate === "string"
        ? a.maturityDate.slice(0, 10)
        : a.maturityDate instanceof Date
          ? a.maturityDate.toISOString().slice(0, 10)
          : null;

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
      maturityDate,
      taxExempt: Boolean(a.taxExempt),
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
    getFixedIncomeBenchmarks({
      forceRefresh: options.forceRefreshBenchmarks,
      onBackgroundRefreshComplete: () => invalidateUserFinancialCaches(userId),
    }),
  ]);

  if (options.forceRefreshBenchmarks) {
    invalidateUserFinancialCaches(userId);
  }

  const assets: AssetInput[] = assetRows.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass as FixedIncomeAssetClassKey,
    sector: a.sector,
    currency: "BRL",
    targetPctInClass: Number(a.targetPctInClass),
    priceMode: "MANUAL",
    manualPrice: a.manualPrice !== null ? Number(a.manualPrice) : 1,
    isActive: a.isActive,
    fixedIncomeIndex: (a.fixedIncomeIndex as FixedIncomeIndexKey | null) ?? null,
    fixedIncomeRate:
      a.fixedIncomeRate !== null ? Number(a.fixedIncomeRate) : null,
    maturityDate: a.maturityDate
      ? a.maturityDate.toISOString().slice(0, 10)
      : null,
    taxExempt: a.taxExempt,
  }));

  const transactions: TransactionInput[] = txRows.map((t) => ({
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
  }));

  return buildFixedIncomeDataFromInputs({ assets, transactions, benchmarks });
}
