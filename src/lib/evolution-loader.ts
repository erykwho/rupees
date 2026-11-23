import { prisma } from "@/lib/prisma";
import { scheduleBackgroundWork } from "@/lib/background-work";
import {
  type QuoteAssetInput,
  getQuotesForAssets,
  refreshStaleQuotesForAssets,
} from "@/lib/quotes";
import {
  getHistoricalDailyQuotes,
  refreshStaleHistoricalDailyQuotes,
} from "@/lib/historical-quotes";
import {
  getFixedIncomeBenchmarks,
  getHistoricalFixedIncomeBenchmarks,
  refreshStaleFixedIncomeBenchmarks,
} from "@/lib/fixed-income-rates";
import {
  type FixedIncomeInitialData,
  buildFixedIncomeDataFromInputs,
} from "@/lib/fixed-income-loader";
import {
  invalidateUserFinancialCaches,
  runCachedForUser,
  userEvolutionTag,
  userFixedIncomeTag,
} from "@/lib/server-cache";
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

export interface EvolutionPageData {
  evolution: EvolutionData;
  fixedIncome: FixedIncomeInitialData;
  refreshedSymbolsCount: number;
}

interface EvolutionSnapshotWithHints extends EvolutionPageData {
  _staleHints?: {
    quoteAssets: QuoteAssetInput[];
    hasStaleQuotes: boolean;
    hasStaleHistory: boolean;
    hasStaleRates: boolean;
    firstTxDate: string | null;
    yesterdayISO: string;
    todayISO: string;
  };
}

const inFlightEvolutionBgRefresh = new Set<string>();

async function loadEvolutionInternal(
  userId: string,
  options: {
    forceRefresh?: boolean;
    includeFixedIncome?: boolean;
    deferBackgroundRefresh?: boolean;
  } = {}
): Promise<EvolutionSnapshotWithHints> {
  const {
    forceRefresh = false,
    includeFixedIncome = true,
    deferBackgroundRefresh = false,
  } = options;

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
    tickerValidationStatus: a.tickerValidationStatus,
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

  const assetQuoteInputs: QuoteAssetInput[] = assets.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass,
    priceMode: a.priceMode,
    tickerValidationStatus: a.tickerValidationStatus,
  }));

  const todayISO = toISODate(new Date());
  const yesterdayISO = addDaysISO(todayISO, -1);
  const onBgComplete = () => invalidateUserFinancialCaches(userId);

  if (transactions.length === 0) {
    const [currentQuoteResult, benchmarks] = await Promise.all([
      getQuotesForAssets(assetQuoteInputs, {
        forceRefresh,
        deferBackgroundRefresh,
        onBackgroundRefreshComplete: onBgComplete,
      }),
      includeFixedIncome
        ? getFixedIncomeBenchmarks({
            forceRefresh,
            deferBackgroundRefresh,
            onBackgroundRefreshComplete: onBgComplete,
          })
        : Promise.resolve(null),
    ]);

    const fixedIncome = benchmarks
      ? buildFixedIncomeDataFromInputs({ assets, transactions, benchmarks })
      : {
          assets: [],
          benchmarks: {
            selic: 14.25,
            cdi: 14.15,
            ipca: 4.5,
            updatedAt: null,
            source: "fallback" as const,
          },
        };

    return {
      evolution: {
        points: [],
        firstTransactionDate: null,
        lastDate: null,
        usdBrl: currentQuoteResult.usdBrl,
        usdBrlUpdatedAt: currentQuoteResult.usdBrlUpdatedAt,
        hasEstimatedFixedIncome: false,
      },
      fixedIncome,
      refreshedSymbolsCount: currentQuoteResult.refreshedCount,
      ...(deferBackgroundRefresh
        ? {
            _staleHints: {
              quoteAssets: assetQuoteInputs,
              hasStaleQuotes: currentQuoteResult.hasStaleQuotes,
              hasStaleHistory: false,
              hasStaleRates: false,
              firstTxDate: null,
              yesterdayISO,
              todayISO,
            },
          }
        : {}),
    };
  }

  const firstTxDate = toISODate(transactions[0].date);
  const hasConfiguredFixedIncome = assets.some(
    (a) => isFixedIncomeClass(a.assetClass) && a.fixedIncomeIndex !== null
  );

  const [
    currentQuoteResult,
    historicalResult,
    fixedIncomeRatesResult,
    standaloneBenchmarks,
  ] = await Promise.all([
    getQuotesForAssets(assetQuoteInputs, {
      forceRefresh,
      deferBackgroundRefresh,
      onBackgroundRefreshComplete: onBgComplete,
    }),
    firstTxDate <= yesterdayISO
      ? getHistoricalDailyQuotes({
          assets: assetQuoteInputs,
          startDate: firstTxDate,
          endDate: yesterdayISO,
          forceRefresh,
          deferBackgroundRefresh,
          onBackgroundRefreshComplete: onBgComplete,
        })
      : Promise.resolve({
          prices: {},
          fetchedSymbolsCount: 0,
          hasStaleHistory: false,
        }),
    hasConfiguredFixedIncome
      ? getHistoricalFixedIncomeBenchmarks({
          startDate: firstTxDate,
          endDate: todayISO,
          forceRefresh,
          deferBackgroundRefresh,
          onBackgroundRefreshComplete: onBgComplete,
        })
      : Promise.resolve(null),
    includeFixedIncome && !hasConfiguredFixedIncome
      ? getFixedIncomeBenchmarks({
          forceRefresh,
          deferBackgroundRefresh,
          onBackgroundRefreshComplete: onBgComplete,
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

  const benchmarks = fixedIncomeRatesResult?.benchmarks ??
    standaloneBenchmarks ?? {
      selic: 14.25,
      cdi: 14.15,
      ipca: 4.5,
      updatedAt: null,
      source: "fallback" as const,
    };

  const fixedIncome = includeFixedIncome
    ? buildFixedIncomeDataFromInputs({ assets, transactions, benchmarks })
    : { assets: [], benchmarks };

  return {
    evolution,
    fixedIncome,
    refreshedSymbolsCount:
      currentQuoteResult.refreshedCount +
      historicalResult.fetchedSymbolsCount +
      (fixedIncomeRatesResult?.fetchedSeriesCount ?? 0),
    ...(deferBackgroundRefresh
      ? {
          _staleHints: {
            quoteAssets: assetQuoteInputs,
            hasStaleQuotes: currentQuoteResult.hasStaleQuotes,
            hasStaleHistory: historicalResult.hasStaleHistory,
            hasStaleRates: fixedIncomeRatesResult?.hasStaleRates ?? false,
            firstTxDate,
            yesterdayISO,
            todayISO,
          },
        }
      : {}),
  };
}

export async function loadUserEvolution(
  userId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<{
  evolution: EvolutionData;
  refreshedSymbolsCount: number;
}> {
  const result = await loadEvolutionInternal(userId, {
    forceRefresh: options.forceRefresh,
    includeFixedIncome: false,
    deferBackgroundRefresh: false,
  });

  if (options.forceRefresh) {
    invalidateUserFinancialCaches(userId);
  }

  return {
    evolution: result.evolution,
    refreshedSymbolsCount: result.refreshedSymbolsCount,
  };
}

/**
 * Shared per-user cached loader for /evolucao that computes both evolution history
 * and fixed-income projection inputs from a single set of DB queries.
 */
export async function loadCachedUserEvolutionPageData(
  userId: string
): Promise<EvolutionPageData> {
  const snapshot = await runCachedForUser({
    keyPrefix: "user-evolution-page",
    userId,
    tags: [userEvolutionTag(userId), userFixedIncomeTag(userId)],
    loader: () =>
      loadEvolutionInternal(userId, {
        forceRefresh: false,
        includeFixedIncome: true,
        deferBackgroundRefresh: true,
      }),
  });

  const hints = snapshot._staleHints;
  if (
    hints &&
    (hints.hasStaleQuotes || hints.hasStaleHistory || hints.hasStaleRates) &&
    !inFlightEvolutionBgRefresh.has(userId)
  ) {
    inFlightEvolutionBgRefresh.add(userId);
    const scheduled = scheduleBackgroundWork(async () => {
      try {
        const [qCount, histCount, bcbCount] = await Promise.all([
          hints.hasStaleQuotes
            ? refreshStaleQuotesForAssets(hints.quoteAssets)
            : Promise.resolve(0),
          hints.hasStaleHistory && hints.firstTxDate
            ? refreshStaleHistoricalDailyQuotes({
                assets: hints.quoteAssets,
                startDate: hints.firstTxDate,
                endDate: hints.yesterdayISO,
              })
            : Promise.resolve(0),
          hints.hasStaleRates && hints.firstTxDate
            ? refreshStaleFixedIncomeBenchmarks({
                startDate: hints.firstTxDate,
                endDate: hints.todayISO,
              })
            : Promise.resolve(0),
        ]);
        if (qCount > 0 || histCount > 0 || bcbCount > 0) {
          invalidateUserFinancialCaches(userId);
        }
      } finally {
        inFlightEvolutionBgRefresh.delete(userId);
      }
    });
    if (!scheduled) {
      inFlightEvolutionBgRefresh.delete(userId);
    }
  }

  return {
    evolution: snapshot.evolution,
    fixedIncome: snapshot.fixedIncome,
    refreshedSymbolsCount: snapshot.refreshedSymbolsCount,
  };
}
