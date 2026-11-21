import { prisma } from "@/lib/prisma";
import { computePortfolioSummary } from "@/lib/domain/calculations";
import {
  computeEstimatedFixedIncomeValuesAsOf,
  toISODate,
} from "@/lib/domain/evolution";
import { getHistoricalFixedIncomeBenchmarks } from "@/lib/fixed-income-rates";
import { getQuotesForAssets } from "@/lib/quotes";
import { ensureSectorGoalsBackfill } from "@/lib/sector-goals";
import {
  type AssetClassKey,
  type AssetInput,
  type CurrencyCode,
  type GoalInput,
  type PortfolioSummary,
  type PriceModeKey,
  type SectorGoalInput,
  type TransactionInput,
  type TransactionTypeKey,
  type VariableIncomeClassKey,
  isFixedIncomeClass,
} from "@/lib/domain/types";

export async function loadUserPortfolio(
  userId: string,
  options: { forceRefreshQuotes?: boolean } = {}
): Promise<{
  summary: PortfolioSummary;
  goal: GoalInput;
  sectorGoals: SectorGoalInput[];
  refreshedQuotesCount: number;
}> {
  await ensureSectorGoalsBackfill(userId);

  const [goalRow, sectorGoalRows, assetRows, txRows] = await Promise.all([
    prisma.allocationGoal.upsert({
      where: { userId },
      update: {},
      create: { userId },
    }),
    prisma.sectorGoal.findMany({
      where: { userId },
      orderBy: [{ assetClass: "asc" }, { targetPct: "desc" }, { name: "asc" }],
    }),
    prisma.asset.findMany({
      where: { userId },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const goal: GoalInput = {
    fixedIncomePct: Number(goalRow.fixedIncomePct),
    variableIncomePct: Number(goalRow.variableIncomePct),
    brazilPct: Number(goalRow.brazilPct),
    usaPct: Number(goalRow.usaPct),
    brStocksPct: Number(goalRow.brStocksPct),
    brFiisPct: Number(goalRow.brFiisPct),
    usStocksPct: Number(goalRow.usStocksPct),
    usReitsPct: Number(goalRow.usReitsPct),
  };

  const sectorGoals: SectorGoalInput[] = sectorGoalRows.map((sg) => ({
    id: sg.id,
    assetClass: sg.assetClass as VariableIncomeClassKey,
    name: sg.name,
    targetPct: Number(sg.targetPct),
  }));

  const assets: AssetInput[] = assetRows.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass as AssetClassKey,
    sector: a.sector,
    currency: a.currency as CurrencyCode,
    targetPctInClass: Number(a.targetPctInClass),
    priceMode: a.priceMode as PriceModeKey,
    manualPrice: a.manualPrice !== null ? Number(a.manualPrice) : null,
    isActive: a.isActive,
    tickerValidationStatus: a.tickerValidationStatus,
    fixedIncomeIndex: a.fixedIncomeIndex ?? null,
    fixedIncomeRate:
      a.fixedIncomeRate !== null ? Number(a.fixedIncomeRate) : null,
    maturityDate: a.maturityDate ? a.maturityDate.toISOString().slice(0, 10) : null,
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

  const configuredFiAssetIds = new Set(
    assets
      .filter((a) => isFixedIncomeClass(a.assetClass) && a.fixedIncomeIndex !== null)
      .map((a) => a.id)
  );
  const firstFiTx = transactions.find((t) => configuredFiAssetIds.has(t.assetId));
  const todayISO = toISODate(new Date());

  const [quoteResult, fixedIncomeRatesResult] = await Promise.all([
    getQuotesForAssets(
      assets.map((a) => ({
        id: a.id,
        ticker: a.ticker,
        assetClass: a.assetClass,
        priceMode: a.priceMode,
        tickerValidationStatus: a.tickerValidationStatus,
      })),
      { forceRefresh: options.forceRefreshQuotes }
    ),
    firstFiTx
      ? getHistoricalFixedIncomeBenchmarks({
          startDate: toISODate(firstFiTx.date),
          endDate: todayISO,
          forceRefresh: options.forceRefreshQuotes,
        })
      : Promise.resolve(null),
  ]);

  const assetsWithFreshStatus: AssetInput[] = assets.map((a) => ({
    ...a,
    tickerValidationStatus:
      quoteResult.updatedStatuses[a.id] ?? a.tickerValidationStatus ?? "VERIFIED",
  }));

  const estimatedFixedIncomeValues = fixedIncomeRatesResult
    ? computeEstimatedFixedIncomeValuesAsOf({
        assets: assetsWithFreshStatus,
        transactions,
        fixedIncomeRates: fixedIncomeRatesResult.rates,
        asOfDateISO: todayISO,
      })
    : undefined;

  const summary = computePortfolioSummary({
    assets: assetsWithFreshStatus,
    transactions,
    goal,
    sectorGoals,
    quotes: quoteResult.quotes,
    usdBrl: quoteResult.usdBrl,
    usdBrlUpdatedAt: quoteResult.usdBrlUpdatedAt,
    estimatedFixedIncomeValues,
  });

  return {
    summary,
    goal,
    sectorGoals,
    refreshedQuotesCount:
      quoteResult.refreshedCount +
      (fixedIncomeRatesResult?.fetchedSeriesCount ?? 0),
  };
}
