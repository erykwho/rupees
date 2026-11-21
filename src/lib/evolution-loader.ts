import { prisma } from "@/lib/prisma";
import { getQuotesForAssets } from "@/lib/quotes";
import { getHistoricalDailyQuotes } from "@/lib/historical-quotes";
import {
  type EvolutionData,
  addDaysISO,
  computePortfolioEvolution,
  toISODate,
} from "@/lib/domain/evolution";
import type {
  AssetClassKey,
  AssetInput,
  CurrencyCode,
  PriceModeKey,
  TransactionInput,
  TransactionTypeKey,
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
  }));

  const transactions: TransactionInput[] = txRows.map((t) => ({
    id: t.id,
    assetId: t.assetId,
    date: t.date,
    type: t.type as TransactionTypeKey,
    quantity: Number(t.quantity),
    unitPrice: Number(t.unitPrice),
    totalAmount: Number(t.totalAmount),
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
      },
      refreshedSymbolsCount: currentQuoteResult.refreshedCount,
    };
  }

  const firstTxDate = toISODate(transactions[0].date);

  const [currentQuoteResult, historicalResult] = await Promise.all([
    getQuotesForAssets(assetQuoteInputs, { forceRefresh }),
    firstTxDate <= yesterdayISO
      ? getHistoricalDailyQuotes({
          assets: assetQuoteInputs,
          startDate: firstTxDate,
          endDate: yesterdayISO,
          forceRefresh,
        })
      : Promise.resolve({ prices: {}, fetchedSymbolsCount: 0 }),
  ]);

  const evolution = computePortfolioEvolution({
    assets,
    transactions,
    historicalPrices: historicalResult.prices,
    currentQuotes: currentQuoteResult.quotes,
    currentUsdBrl: currentQuoteResult.usdBrl,
    currentUsdBrlUpdatedAt: currentQuoteResult.usdBrlUpdatedAt,
    todayISO,
  });

  return {
    evolution,
    refreshedSymbolsCount:
      currentQuoteResult.refreshedCount + historicalResult.fetchedSymbolsCount,
  };
}
