import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
import { scheduleBackgroundWork } from "@/lib/background-work";
import { type AssetClassKey, getYahooSymbol } from "@/lib/domain/types";
import { addDaysISO, toISODate } from "@/lib/domain/evolution";

const USD_BRL_SYMBOL = "USDBRL=X";
const CONCURRENCY_LIMIT = 5;
const SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const CHART_FETCH_TIMEOUT_MS = 5000;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface HistoricalQuotesResult {
  prices: Record<string, Record<string, number>>;
  fetchedSymbolsCount: number;
  hasStaleHistory: boolean;
}

interface FetchJob {
  symbol: string;
  ranges: Array<{ from: string; to: string }>;
  newCoveredFrom: string;
  newCoveredTo: string;
  isCold: boolean;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Yahoo chart timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function collectHistoricalSymbols(
  assets: Array<{ ticker: string; assetClass: AssetClassKey; priceMode: string }>
): string[] {
  const symbols = new Set<string>([USD_BRL_SYMBOL]);
  for (const asset of assets) {
    if (asset.priceMode !== "AUTO_YAHOO") continue;
    const sym = getYahooSymbol(asset.ticker, asset.assetClass);
    if (sym) symbols.add(sym);
  }
  return Array.from(symbols);
}

function planHistoricalQuoteJobs(params: {
  symbolList: string[];
  syncMap: Map<string, { coveredFrom: string; coveredTo: string; updatedAt: Date }>;
  paddedStart: string;
  endDate: string;
  forceRefresh: boolean;
  now: number;
}): {
  syncJobs: FetchJob[];
  backgroundJobs: FetchJob[];
} {
  const { symbolList, syncMap, paddedStart, endDate, forceRefresh, now } =
    params;
  const syncJobs: FetchJob[] = [];
  const backgroundJobs: FetchJob[] = [];

  for (const symbol of symbolList) {
    const sync = syncMap.get(symbol);
    if (forceRefresh || !sync) {
      syncJobs.push({
        symbol,
        ranges: [{ from: paddedStart, to: endDate }],
        newCoveredFrom: paddedStart,
        newCoveredTo: endDate,
        isCold: !sync,
      });
      continue;
    }

    const ranges: Array<{ from: string; to: string }> = [];
    if (paddedStart < sync.coveredFrom) {
      ranges.push({ from: paddedStart, to: sync.coveredFrom });
    }
    if (endDate > sync.coveredTo) {
      ranges.push({ from: sync.coveredTo, to: endDate });
    }

    if (ranges.length === 0) continue;

    // Respect cooldown to avoid repeated calls on weekends or delisted/failing tickers
    const recentlySynced = now - sync.updatedAt.getTime() <= SYNC_COOLDOWN_MS;
    if (recentlySynced && paddedStart >= sync.coveredFrom) {
      continue;
    }

    backgroundJobs.push({
      symbol,
      ranges,
      newCoveredFrom:
        paddedStart < sync.coveredFrom ? paddedStart : sync.coveredFrom,
      newCoveredTo: endDate > sync.coveredTo ? endDate : sync.coveredTo,
      isCold: false,
    });
  }

  return { syncJobs, backgroundJobs };
}

async function executeHistoricalQuoteJobs(params: {
  jobs: FetchJob[];
  paddedStart: string;
  endDate: string;
  forceRefresh: boolean;
}): Promise<number> {
  const { jobs, paddedStart, endDate, forceRefresh } = params;
  if (jobs.length === 0) return 0;

  let fetchedSymbolsCount = 0;

  for (let i = 0; i < jobs.length; i += CONCURRENCY_LIMIT) {
    const chunk = jobs.slice(i, i + CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      chunk.map(async (job) => {
        const allRows: Array<{
          symbol: string;
          date: string;
          closePrice: number;
          currency: string;
        }> = [];
        let anySuccess = false;

        for (const range of job.ranges) {
          const fetched = await fetchYahooDailyChart(
            job.symbol,
            range.from,
            range.to
          );
          if (fetched !== null) {
            anySuccess = true;
            allRows.push(...fetched);
          }
        }

        if (!anySuccess) {
          if (!job.isCold) {
            await prisma.historicalQuoteSync
              .update({
                where: { symbol: job.symbol },
                data: { updatedAt: new Date() },
              })
              .catch(() => undefined);
          }
          return false;
        }

        if (forceRefresh) {
          await prisma.historicalQuoteCache.deleteMany({
            where: {
              symbol: job.symbol,
              date: { gte: paddedStart, lte: endDate },
            },
          });
        }

        if (allRows.length > 0) {
          await prisma.historicalQuoteCache.createMany({
            data: allRows,
            skipDuplicates: true,
          });
        }

        await prisma.historicalQuoteSync.upsert({
          where: { symbol: job.symbol },
          update: {
            coveredFrom: job.newCoveredFrom,
            coveredTo: job.newCoveredTo,
          },
          create: {
            symbol: job.symbol,
            coveredFrom: job.newCoveredFrom,
            coveredTo: job.newCoveredTo,
          },
        });

        return true;
      })
    );

    for (const res of results) {
      if (res.status === "fulfilled" && res.value) {
        fetchedSymbolsCount++;
      }
    }
  }

  return fetchedSymbolsCount;
}

export async function getHistoricalDailyQuotes(params: {
  assets: Array<{ ticker: string; assetClass: AssetClassKey; priceMode: string }>;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD" (typically yesterday)
  forceRefresh?: boolean;
  deferBackgroundRefresh?: boolean;
  onBackgroundRefreshComplete?: () => void;
}): Promise<HistoricalQuotesResult> {
  const {
    assets,
    startDate,
    endDate,
    forceRefresh = false,
    deferBackgroundRefresh = false,
    onBackgroundRefreshComplete,
  } = params;

  if (!startDate || !endDate || startDate > endDate) {
    return { prices: {}, fetchedSymbolsCount: 0, hasStaleHistory: false };
  }

  const symbolList = collectHistoricalSymbols(assets);
  // Pad start date by 10 days so carry-forward works if first transaction falls on a holiday/weekend
  const paddedStart = addDaysISO(startDate, -10);

  // Read sync metadata and cached daily prices in parallel (1 DB roundtrip on warm path)
  const [syncRows, initialCachedRows] = await Promise.all([
    prisma.historicalQuoteSync.findMany({
      where: { symbol: { in: symbolList } },
    }),
    prisma.historicalQuoteCache.findMany({
      where: {
        symbol: { in: symbolList },
        date: { gte: paddedStart, lte: endDate },
      },
      select: {
        symbol: true,
        date: true,
        closePrice: true,
      },
    }),
  ]);

  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));
  const { syncJobs, backgroundJobs } = planHistoricalQuoteJobs({
    symbolList,
    syncMap,
    paddedStart,
    endDate,
    forceRefresh,
    now: Date.now(),
  });

  const fetchedSymbolsCount = await executeHistoricalQuoteJobs({
    jobs: syncJobs,
    paddedStart,
    endDate,
    forceRefresh,
  });

  const cachedRows =
    fetchedSymbolsCount > 0
      ? await prisma.historicalQuoteCache.findMany({
          where: {
            symbol: { in: symbolList },
            date: { gte: paddedStart, lte: endDate },
          },
          select: {
            symbol: true,
            date: true,
            closePrice: true,
          },
        })
      : initialCachedRows;

  const hasStaleHistory = backgroundJobs.length > 0;
  if (hasStaleHistory && !deferBackgroundRefresh) {
    scheduleBackgroundWork(async () => {
      const bgCount = await executeHistoricalQuoteJobs({
        jobs: backgroundJobs,
        paddedStart,
        endDate,
        forceRefresh: false,
      });
      if (bgCount > 0) {
        onBackgroundRefreshComplete?.();
      }
    });
  }

  const prices: Record<string, Record<string, number>> = {};
  for (const row of cachedRows) {
    let map = prices[row.symbol];
    if (!map) {
      map = {};
      prices[row.symbol] = map;
    }
    map[row.date] = Number(row.closePrice);
  }

  return {
    prices,
    fetchedSymbolsCount,
    hasStaleHistory,
  };
}

/**
 * Refreshes incremental historical daily quotes in the background without blocking navigation.
 */
export async function refreshStaleHistoricalDailyQuotes(params: {
  assets: Array<{ ticker: string; assetClass: AssetClassKey; priceMode: string }>;
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { assets, startDate, endDate } = params;
  if (!startDate || !endDate || startDate > endDate) return 0;

  const symbolList = collectHistoricalSymbols(assets);
  const paddedStart = addDaysISO(startDate, -10);
  const syncRows = await prisma.historicalQuoteSync.findMany({
    where: { symbol: { in: symbolList } },
  });
  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));

  const { syncJobs, backgroundJobs } = planHistoricalQuoteJobs({
    symbolList,
    syncMap,
    paddedStart,
    endDate,
    forceRefresh: false,
    now: Date.now(),
  });

  return executeHistoricalQuoteJobs({
    jobs: [...syncJobs, ...backgroundJobs],
    paddedStart,
    endDate,
    forceRefresh: false,
  });
}

async function fetchYahooDailyChart(
  symbol: string,
  fromISO: string,
  toISO: string
): Promise<Array<{
  symbol: string;
  date: string;
  closePrice: number;
  currency: string;
}> | null> {
  try {
    const period1 = new Date(`${fromISO}T00:00:00Z`);
    // Add 1 day to period2 so Yahoo includes the toISO trading session
    const period2 = new Date(`${addDaysISO(toISO, 1)}T23:59:59Z`);

    const chart = await withTimeout(
      yahooFinance.chart(symbol, {
        period1,
        period2,
        interval: "1d",
      }),
      CHART_FETCH_TIMEOUT_MS
    );

    const currency =
      chart?.meta?.currency ?? (symbol.endsWith(".SA") ? "BRL" : "USD");
    const quotes = chart?.quotes ?? [];

    const dedup = new Map<string, number>();
    for (const q of quotes) {
      if (!q?.date) continue;
      const close = q.close;
      if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) {
        continue;
      }
      const dateStr = toISODate(q.date);
      if (dateStr >= fromISO && dateStr <= toISO) {
        dedup.set(dateStr, close);
      }
    }

    return Array.from(dedup.entries()).map(([date, closePrice]) => ({
      symbol,
      date,
      closePrice,
      currency,
    }));
  } catch {
    return null;
  }
}
