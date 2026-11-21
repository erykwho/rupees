import { prisma } from "@/lib/prisma";
import { getQuotesForAssets } from "@/lib/quotes";
import { getHistoricalDailyQuotes } from "@/lib/historical-quotes";
import { getHistoricalFixedIncomeBenchmarks } from "@/lib/fixed-income-rates";
import {
  type EvolutionData,
  addDaysISO,
  computePortfolioEvolution,
  toISODate,
} from "@/lib/domain/evolution";
import {
  type AssetClassKey,
  type AssetInput,
  type CurrencyCode,
  type FixedIncomeIndexKey,
  type PriceModeKey,
  type TransactionInput,
  type TransactionTypeKey,
  isFixedIncomeClass,
} from "@/lib/domain/types";

export async function loadUserEvolution(
  userId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<{
  evolution: EvolutionData;
  refreshedSymbolsCount: number;
}> {
  const { forceRefresh = false } = options;

  const [assetRows, txRows] = await Promise.all([
    prisma.asset.findMany({
      where: { userId },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    }),
    prisma.transaction.findMany({
      where: { userId },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

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
    fixedIncomeIndex: (a.fixedIncomeIndex as FixedIncomeIndexKey | null) ?? null,
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

  const assetQuoteInputs = assets.map((a) => ({
    ticker: a.ticker,
    assetClass: a.assetClass,
    priceMode: a.priceMode,
  }));

  const todayISO = toISODate(new Date());
  const yesterdayISO = addDaysISO(todayISO, -1);

  if (transactions.length === 0) {
    const currentQuoteResult = await getQuotesForAssets(assetQuoteInputs, {
      forceRefresh,
    });
    return {
      evolution: {
        points: [],
        firstTransactionDate: null,
        lastDate: null,
        usdBrl: currentQuoteResult.usdBrl,
        usdBrlUpdatedAt: currentQuoteResult.usdBrlUpdatedAt,
        hasEstimatedFixedIncome: false,
      },
      refreshedSymbolsCount: currentQuoteResult.refreshedCount,
    };
  }

  const firstTxDate = toISODate(transactions[0].date);
  const hasConfiguredFixedIncome = assets.some(
    (a) => isFixedIncomeClass(a.assetClass) && a.fixedIncomeIndex !== null
  );

  const [currentQuoteResult, historicalResult, fixedIncomeRatesResult] =
    await Promise.all([
      getQuotesForAssets(assetQuoteInputs, { forceRefresh }),
      firstTxDate <= yesterdayISO
        ? getHistoricalDailyQuotes({
            assets: assetQuoteInputs,
            startDate: firstTxDate,
            endDate: yesterdayISO,
            forceRefresh,
          })
        : Promise.resolve({ prices: {}, fetchedSymbolsCount: 0 }),
      hasConfiguredFixedIncome
        ? getHistoricalFixedIncomeBenchmarks({
            startDate: firstTxDate,
            endDate: todayISO,
            forceRefresh,
          })
        : Promise.resolve(null),
    ]);

  const evolution = computePortfolioEvolution({
    assets,
    transactions,
    historicalPrices: historicalResult.prices,
    currentQuotes: currentQuoteResult.quotes,
    currentUsdBrl: currentQuoteResult.usdBrl,
    currentUsdBrlUpdatedAt: currentQuoteResult.usdBrlUpdatedAt,
    todayISO,
    fixedIncomeRates: fixedIncomeRatesResult?.rates,
  });

  return {
    evolution,
    refreshedSymbolsCount:
      currentQuoteResult.refreshedCount +
      historicalResult.fetchedSymbolsCount +
      (fixedIncomeRatesResult?.fetchedSeriesCount ?? 0),
  };
}
