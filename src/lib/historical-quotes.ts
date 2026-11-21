import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
import { type AssetClassKey, getYahooSymbol } from "@/lib/domain/types";
import { addDaysISO, toISODate } from "@/lib/domain/evolution";

const USD_BRL_SYMBOL = "USDBRL=X";
const CONCURRENCY_LIMIT = 5;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface HistoricalQuotesResult {
  prices: Record<string, Record<string, number>>;
  fetchedSymbolsCount: number;
}

export async function getHistoricalDailyQuotes(params: {
  assets: Array<{ ticker: string; assetClass: AssetClassKey; priceMode: string }>;
  startDate: string; // "YYYY-MM-DD"
  endDate: string; // "YYYY-MM-DD" (typically yesterday)
  forceRefresh?: boolean;
}): Promise<HistoricalQuotesResult> {
  const { assets, startDate, endDate, forceRefresh = false } = params;

  if (!startDate || !endDate || startDate > endDate) {
    return { prices: {}, fetchedSymbolsCount: 0 };
  }

  const symbols = new Set<string>([USD_BRL_SYMBOL]);
  for (const asset of assets) {
    if (asset.priceMode !== "AUTO_YAHOO") continue;
    const sym = getYahooSymbol(asset.ticker, asset.assetClass);
    if (sym) symbols.add(sym);
  }

  const symbolList = Array.from(symbols);
  // Pad start date by 10 days so carry-forward works if first transaction falls on a holiday/weekend
  const paddedStart = addDaysISO(startDate, -10);

  const syncRows = await prisma.historicalQuoteSync.findMany({
    where: { symbol: { in: symbolList } },
  });
  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));

  interface FetchJob {
    symbol: string;
    ranges: Array<{ from: string; to: string }>;
    newCoveredFrom: string;
    newCoveredTo: string;
  }

  const jobs: FetchJob[] = [];

  for (const symbol of symbolList) {
    const sync = syncMap.get(symbol);
    if (forceRefresh || !sync) {
      jobs.push({
        symbol,
        ranges: [{ from: paddedStart, to: endDate }],
        newCoveredFrom: paddedStart,
        newCoveredTo: endDate,
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

    if (ranges.length > 0) {
      jobs.push({
        symbol,
        ranges,
        newCoveredFrom: paddedStart < sync.coveredFrom ? paddedStart : sync.coveredFrom,
        newCoveredTo: endDate > sync.coveredTo ? endDate : sync.coveredTo,
      });
    }
  }

  let fetchedSymbolsCount = 0;

  if (jobs.length > 0) {
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

          if (!anySuccess) return false;

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
  }

  const cachedRows = await prisma.historicalQuoteCache.findMany({
    where: {
      symbol: { in: symbolList },
      date: { gte: paddedStart, lte: endDate },
    },
    select: {
      symbol: true,
      date: true,
      closePrice: true,
    },
  });

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
  };
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

    const chart = await yahooFinance.chart(symbol, {
      period1,
      period2,
      interval: "1d",
    });

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
