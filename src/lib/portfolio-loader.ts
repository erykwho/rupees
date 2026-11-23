import { prisma } from "@/lib/prisma";
import { scheduleBackgroundWork } from "@/lib/background-work";
import { computePortfolioSummary } from "@/lib/domain/calculations";
import {
  computeEstimatedFixedIncomeValuesAsOf,
  toISODate,
} from "@/lib/domain/evolution";
import {
  getHistoricalFixedIncomeBenchmarks,
  refreshStaleFixedIncomeBenchmarks,
} from "@/lib/fixed-income-rates";
import {
  type QuoteAssetInput,
  getQuotesForAssets,
  refreshStaleQuotesForAssets,
} from "@/lib/quotes";
import { ensureSectorGoalsBackfill } from "@/lib/sector-goals";
import {
  invalidateUserFinancialCaches,
  runCachedForUser,
  userPortfolioTag,
} from "@/lib/server-cache";
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
  isVariableIncomeClass,
} from "@/lib/domain/types";

export interface LoadedPortfolio {
  summary: PortfolioSummary;
  goal: GoalInput;
  sectorGoals: SectorGoalInput[];
  refreshedQuotesCount: number;
}

interface PortfolioSnapshotWithHints extends LoadedPortfolio {
  _staleHints?: {
    quoteAssets: QuoteAssetInput[];
    hasStaleQuotes: boolean;
    bcbStartDate: string | null;
    bcbEndDate: string | null;
    hasStaleRates: boolean;
  };
}

const inFlightPortfolioBgRefresh = new Set<string>();

async function loadPortfolioInternal(
  userId: string,
  options: {
    forceRefreshQuotes?: boolean;
    deferBackgroundRefresh?: boolean;
  } = {}
): Promise<PortfolioSnapshotWithHints> {
  const { forceRefreshQuotes = false, deferBackgroundRefresh = false } =
    options;

  const [initialGoalRow, initialSectorGoalRows, assetRows, txRows] =
    await Promise.all([
      prisma.allocationGoal.findUnique({
        where: { userId },
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

  // Run one-time defaults/backfills lazily ONLY when missing (eliminates serial queries on warm accounts)
  const needsSectorBackfill =
    initialSectorGoalRows.length === 0 &&
    assetRows.some((a) => isVariableIncomeClass(a.assetClass as AssetClassKey));

  const [goalRow, sectorGoalRows] = await Promise.all([
    initialGoalRow
      ? Promise.resolve(initialGoalRow)
      : prisma.allocationGoal.upsert({
          where: { userId },
          update: {},
          create: { userId },
        }),
    needsSectorBackfill
      ? ensureSectorGoalsBackfill(userId).then(() =>
          prisma.sectorGoal.findMany({
            where: { userId },
            orderBy: [
              { assetClass: "asc" },
              { targetPct: "desc" },
              { name: "asc" },
            ],
          })
        )
      : Promise.resolve(initialSectorGoalRows),
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

  const configuredFiAssetIds = new Set(
    assets
      .filter(
        (a) => isFixedIncomeClass(a.assetClass) && a.fixedIncomeIndex !== null
      )
      .map((a) => a.id)
  );
  const firstFiTx = transactions.find((t) => configuredFiAssetIds.has(t.assetId));
  const todayISO = toISODate(new Date());
  const bcbStartDate = firstFiTx ? toISODate(firstFiTx.date) : null;

  const quoteAssets: QuoteAssetInput[] = assets.map((a) => ({
    id: a.id,
    ticker: a.ticker,
    assetClass: a.assetClass,
    priceMode: a.priceMode,
    tickerValidationStatus: a.tickerValidationStatus,
  }));

  const onBgComplete = () => invalidateUserFinancialCaches(userId);

  const [quoteResult, fixedIncomeRatesResult] = await Promise.all([
    getQuotesForAssets(quoteAssets, {
      forceRefresh: forceRefreshQuotes,
      deferBackgroundRefresh,
      onBackgroundRefreshComplete: onBgComplete,
    }),
    bcbStartDate
      ? getHistoricalFixedIncomeBenchmarks({
          startDate: bcbStartDate,
          endDate: todayISO,
          forceRefresh: forceRefreshQuotes,
          deferBackgroundRefresh,
          onBackgroundRefreshComplete: onBgComplete,
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
    ...(deferBackgroundRefresh
      ? {
          _staleHints: {
            quoteAssets,
            hasStaleQuotes: quoteResult.hasStaleQuotes,
            bcbStartDate,
            bcbEndDate: bcbStartDate ? todayISO : null,
            hasStaleRates: fixedIncomeRatesResult?.hasStaleRates ?? false,
          },
        }
      : {}),
  };
}

export async function loadUserPortfolio(
  userId: string,
  options: { forceRefreshQuotes?: boolean } = {}
): Promise<LoadedPortfolio> {
  const result = await loadPortfolioInternal(userId, {
    forceRefreshQuotes: options.forceRefreshQuotes,
    deferBackgroundRefresh: false,
  });

  if (options.forceRefreshQuotes) {
    invalidateUserFinancialCaches(userId);
  }

  return {
    summary: result.summary,
    goal: result.goal,
    sectorGoals: result.sectorGoals,
    refreshedQuotesCount: result.refreshedQuotesCount,
  };
}

/**
 * Per-user cached portfolio loader for Server Component pages (/, /carteira, /aporte, /objetivos).
 * Reuses the computed snapshot across portfolio routes for 60s and invalidates immediately on mutations.
 */
export async function loadCachedUserPortfolio(
  userId: string
): Promise<LoadedPortfolio> {
  const snapshot = await runCachedForUser({
    keyPrefix: "user-portfolio",
    userId,
    tags: [userPortfolioTag(userId)],
    loader: () =>
      loadPortfolioInternal(userId, {
        forceRefreshQuotes: false,
        deferBackgroundRefresh: true,
      }),
  });

  const hints = snapshot._staleHints;
  if (
    hints &&
    (hints.hasStaleQuotes || hints.hasStaleRates) &&
    !inFlightPortfolioBgRefresh.has(userId)
  ) {
    inFlightPortfolioBgRefresh.add(userId);
    const scheduled = scheduleBackgroundWork(async () => {
      try {
        const [qCount, bcbCount] = await Promise.all([
          hints.hasStaleQuotes
            ? refreshStaleQuotesForAssets(hints.quoteAssets)
            : Promise.resolve(0),
          hints.hasStaleRates && hints.bcbStartDate && hints.bcbEndDate
            ? refreshStaleFixedIncomeBenchmarks({
                startDate: hints.bcbStartDate,
                endDate: hints.bcbEndDate,
              })
            : Promise.resolve(0),
        ]);
        if (qCount > 0 || bcbCount > 0) {
          invalidateUserFinancialCaches(userId);
        }
      } finally {
        inFlightPortfolioBgRefresh.delete(userId);
      }
    });
    if (!scheduled) {
      inFlightPortfolioBgRefresh.delete(userId);
    }
  }

  return {
    summary: snapshot.summary,
    goal: snapshot.goal,
    sectorGoals: snapshot.sectorGoals,
    refreshedQuotesCount: snapshot.refreshedQuotesCount,
  };
}
