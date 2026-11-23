import { prisma } from "@/lib/prisma";
import { scheduleBackgroundWork } from "@/lib/background-work";
import type {
  BenchmarkRates,
  HistoricalBenchmarkRates,
} from "@/lib/domain/fixed-income";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const HIST_SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours
const SYNC_FETCH_TIMEOUT_MS = 3500;
const BG_FETCH_TIMEOUT_MS = 6000;

const SYMBOL_SELIC = "BCB:SELIC";
const SYMBOL_CDI = "BCB:CDI";
const SYMBOL_IPCA = "BCB:IPCA12M";
const BENCHMARK_SYMBOLS = [SYMBOL_SELIC, SYMBOL_CDI, SYMBOL_IPCA];

const DEFAULT_SELIC = 14.25;
const DEFAULT_CDI = 14.15;
const DEFAULT_IPCA = 4.5;

const HIST_SYMBOL_SELIC = "BCB:HIST:SELIC";
const HIST_SYMBOL_CDI = "BCB:HIST:CDI";
const HIST_SYMBOL_IPCA = "BCB:HIST:IPCA";
const MAX_BCB_WINDOW_DAYS = 1800; // ~5 years (BCB limits daily series to 10 years)

const SERIES_CONFIGS = [
  { symbol: HIST_SYMBOL_SELIC, code: 432, isMonthly: false },
  { symbol: HIST_SYMBOL_CDI, code: 4389, isMonthly: false },
  { symbol: HIST_SYMBOL_IPCA, code: 433, isMonthly: true },
] as const;

const HIST_SYMBOL_LIST = SERIES_CONFIGS.map((s) => s.symbol);

interface BcbSgsEntry {
  data: string;
  valor: string;
}

type QuoteCacheRow = {
  symbol: string;
  price: unknown;
  currency: string;
  updatedAt: Date;
};

async function fetchBcbSeries(
  seriesCode: number,
  lastN: number,
  timeoutMs: number
): Promise<BcbSgsEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados/ultimos/${lastN}?formato=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json) || json.length === 0) return null;
    return json as BcbSgsEntry[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseBcbNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const num = Number(raw.replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildBenchmarkRatesFromMap(
  cachedMap: Map<string, QuoteCacheRow>,
  source: BenchmarkRates["source"]
): BenchmarkRates {
  const selicRow = cachedMap.get(SYMBOL_SELIC);
  const cdiRow = cachedMap.get(SYMBOL_CDI);
  const ipcaRow = cachedMap.get(SYMBOL_IPCA);

  const selic = selicRow ? round2(Number(selicRow.price)) : DEFAULT_SELIC;
  const cdi = cdiRow
    ? round2(Number(cdiRow.price))
    : selicRow
      ? round2(Math.max(0, selic - 0.1))
      : DEFAULT_CDI;
  const ipca = ipcaRow ? round2(Number(ipcaRow.price)) : DEFAULT_IPCA;

  const latestUpdatedAt =
    [selicRow, cdiRow, ipcaRow]
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
      ?.updatedAt.toISOString() ?? null;

  return {
    selic,
    cdi,
    ipca,
    updatedAt: latestUpdatedAt,
    source,
  };
}

async function fetchAndPersistBenchmarks(
  cachedMap: Map<string, QuoteCacheRow>,
  timeoutMs: number
): Promise<{ updatedCount: number; rates: BenchmarkRates }> {
  // Series 432: Selic target (% p.a.)
  // Series 4389: Annualized CDI base 252 (% p.a.)
  // Series 433: Monthly IPCA (%) -> compounded over last 12 months
  const [selicData, cdiData, ipcaData] = await Promise.all([
    fetchBcbSeries(432, 1, timeoutMs),
    fetchBcbSeries(4389, 1, timeoutMs),
    fetchBcbSeries(433, 12, timeoutMs),
  ]);

  const fetchedSelic = parseBcbNumber(selicData?.[selicData.length - 1]?.valor);
  const fetchedCdi = parseBcbNumber(cdiData?.[cdiData.length - 1]?.valor);

  let fetchedIpca: number | null = null;
  if (ipcaData && ipcaData.length >= 12) {
    let factor = 1;
    let valid = true;
    for (const entry of ipcaData.slice(-12)) {
      const val = parseBcbNumber(entry.valor);
      if (val === null) {
        valid = false;
        break;
      }
      factor *= 1 + val / 100;
    }
    if (valid) {
      fetchedIpca = round2((factor - 1) * 100);
    }
  }

  const upserts: Array<{ symbol: string; value: number }> = [];
  if (fetchedSelic !== null && fetchedSelic >= 0) {
    upserts.push({ symbol: SYMBOL_SELIC, value: round2(fetchedSelic) });
  }
  if (fetchedCdi !== null && fetchedCdi >= 0) {
    upserts.push({ symbol: SYMBOL_CDI, value: round2(fetchedCdi) });
  } else if (fetchedSelic !== null && fetchedSelic >= 0) {
    upserts.push({
      symbol: SYMBOL_CDI,
      value: round2(Math.max(0, fetchedSelic - 0.1)),
    });
  }
  if (fetchedIpca !== null && fetchedIpca >= 0) {
    upserts.push({ symbol: SYMBOL_IPCA, value: fetchedIpca });
  }

  let updatedCount = 0;
  if (upserts.length > 0) {
    const results = await Promise.allSettled(
      upserts.map((item) =>
        prisma.quoteCache.upsert({
          where: { symbol: item.symbol },
          update: { price: item.value, currency: "PCT" },
          create: { symbol: item.symbol, price: item.value, currency: "PCT" },
        })
      )
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        cachedMap.set(r.value.symbol, r.value);
        updatedCount++;
      }
    }
  }

  const hasAnyCached = BENCHMARK_SYMBOLS.some((s) => cachedMap.has(s));
  const source: BenchmarkRates["source"] =
    upserts.length > 0 ? "bcb" : hasAnyCached ? "cache" : "fallback";

  return {
    updatedCount,
    rates: buildBenchmarkRatesFromMap(cachedMap, source),
  };
}

/**
 * Fetches Brazilian benchmark rates (Selic target, annualized CDI, and 12m IPCA)
 * from Banco Central (SGS) with a 12h QuoteCache TTL, SWR background refresh,
 * and safe defaults on failure.
 */
export async function getFixedIncomeBenchmarks(
  options: {
    forceRefresh?: boolean;
    deferBackgroundRefresh?: boolean;
    onBackgroundRefreshComplete?: () => void;
  } = {}
): Promise<BenchmarkRates> {
  const {
    forceRefresh = false,
    deferBackgroundRefresh = false,
    onBackgroundRefreshComplete,
  } = options;

  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: BENCHMARK_SYMBOLS } },
  });

  const now = Date.now();
  const cachedMap = new Map<string, QuoteCacheRow>(
    cachedRows.map((r) => [r.symbol, r])
  );

  const hasAllCached = BENCHMARK_SYMBOLS.every((sym) => cachedMap.has(sym));
  const isFresh =
    hasAllCached &&
    BENCHMARK_SYMBOLS.every((sym) => {
      const row = cachedMap.get(sym)!;
      return now - row.updatedAt.getTime() <= CACHE_TTL_MS;
    });

  if (!forceRefresh && hasAllCached) {
    if (!isFresh && !deferBackgroundRefresh) {
      scheduleBackgroundWork(async () => {
        const bgMap = new Map<string, QuoteCacheRow>(cachedMap);
        const { updatedCount } = await fetchAndPersistBenchmarks(
          bgMap,
          BG_FETCH_TIMEOUT_MS
        );
        if (updatedCount > 0) {
          onBackgroundRefreshComplete?.();
        }
      });
    }
    return buildBenchmarkRatesFromMap(cachedMap, "cache");
  }

  const timeoutMs = forceRefresh ? BG_FETCH_TIMEOUT_MS : SYNC_FETCH_TIMEOUT_MS;
  const { rates } = await fetchAndPersistBenchmarks(cachedMap, timeoutMs);
  return rates;
}

function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatIsoToBcbDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function parseBcbDateToISO(raw: string | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

async function fetchBcbSeriesRangeChunk(
  seriesCode: number,
  fromISO: string,
  toISO: string,
  timeoutMs: number
): Promise<BcbSgsEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const startParam = formatIsoToBcbDate(fromISO);
    const endParam = formatIsoToBcbDate(toISO);
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${seriesCode}/dados?formato=json&dataInicial=${startParam}&dataFinal=${endParam}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) return null;
    return json as BcbSgsEntry[];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBcbSeriesRange(
  seriesCode: number,
  fromISO: string,
  toISO: string,
  timeoutMs: number
): Promise<Array<{ date: string; value: number }> | null> {
  if (fromISO > toISO) return [];

  const dedup = new Map<string, number>();
  let anySuccess = false;
  let cursor = fromISO;

  while (cursor <= toISO) {
    const chunkEnd = addDaysISO(cursor, MAX_BCB_WINDOW_DAYS);
    const effectiveEnd = chunkEnd < toISO ? chunkEnd : toISO;
    const entries = await fetchBcbSeriesRangeChunk(
      seriesCode,
      cursor,
      effectiveEnd,
      timeoutMs
    );
    if (entries !== null) {
      anySuccess = true;
      for (const entry of entries) {
        const iso = parseBcbDateToISO(entry.data);
        const val = parseBcbNumber(entry.valor);
        if (iso && val !== null) {
          dedup.set(iso, val);
        }
      }
    }
    cursor = addDaysISO(effectiveEnd, 1);
  }

  if (!anySuccess) return null;
  return Array.from(dedup.entries()).map(([date, value]) => ({ date, value }));
}

interface HistoricalSeriesSyncJob {
  symbol: string;
  code: number;
  ranges: Array<{ from: string; to: string }>;
  newCoveredFrom: string;
  newCoveredTo: string;
  isCold: boolean;
}

function planHistoricalSeriesJobs(params: {
  syncMap: Map<string, { coveredFrom: string; coveredTo: string; updatedAt: Date }>;
  paddedStart: string;
  endDate: string;
  forceRefresh: boolean;
  now: number;
}): {
  syncJobs: HistoricalSeriesSyncJob[];
  backgroundJobs: HistoricalSeriesSyncJob[];
} {
  const { syncMap, paddedStart, endDate, forceRefresh, now } = params;
  const syncJobs: HistoricalSeriesSyncJob[] = [];
  const backgroundJobs: HistoricalSeriesSyncJob[] = [];

  for (const cfg of SERIES_CONFIGS) {
    const sync = syncMap.get(cfg.symbol);

    if (forceRefresh || !sync) {
      syncJobs.push({
        symbol: cfg.symbol,
        code: cfg.code,
        ranges: [{ from: paddedStart, to: endDate }],
        newCoveredFrom: paddedStart,
        newCoveredTo: endDate,
        isCold: !sync,
      });
      continue;
    }

    const ranges: Array<{ from: string; to: string }> = [];
    const newCoveredFrom =
      paddedStart < sync.coveredFrom ? paddedStart : sync.coveredFrom;
    const newCoveredTo = endDate > sync.coveredTo ? endDate : sync.coveredTo;

    if (paddedStart < sync.coveredFrom) {
      ranges.push({ from: paddedStart, to: sync.coveredFrom });
    }
    if (endDate > sync.coveredTo) {
      // Re-fetch last 60 days for monthly IPCA to pick up recent publications
      const tailStart = cfg.isMonthly
        ? addDaysISO(sync.coveredTo, -60)
        : sync.coveredTo;
      ranges.push({ from: tailStart, to: endDate });
    }

    if (ranges.length === 0) continue;

    // Respect cooldown to prevent repeated BCB calls on weekends/holidays or during outages
    const recentlySynced =
      now - sync.updatedAt.getTime() <= HIST_SYNC_COOLDOWN_MS;
    if (recentlySynced && paddedStart >= sync.coveredFrom) {
      continue;
    }

    backgroundJobs.push({
      symbol: cfg.symbol,
      code: cfg.code,
      ranges,
      newCoveredFrom,
      newCoveredTo,
      isCold: false,
    });
  }

  return { syncJobs, backgroundJobs };
}

async function executeHistoricalSeriesJobs(params: {
  jobs: HistoricalSeriesSyncJob[];
  paddedStart: string;
  endDate: string;
  forceRefresh: boolean;
  timeoutMs: number;
}): Promise<number> {
  const { jobs, paddedStart, endDate, forceRefresh, timeoutMs } = params;
  if (jobs.length === 0) return 0;

  let fetchedSeriesCount = 0;

  const syncResults = await Promise.allSettled(
    jobs.map(async (job) => {
      const rowsToInsert: Array<{
        symbol: string;
        date: string;
        closePrice: number;
        currency: string;
      }> = [];
      let anySuccess = false;

      for (const range of job.ranges) {
        const fetched = await fetchBcbSeriesRange(
          job.code,
          range.from,
          range.to,
          timeoutMs
        );
        if (fetched !== null) {
          anySuccess = true;
          for (const item of fetched) {
            rowsToInsert.push({
              symbol: job.symbol,
              date: item.date,
              closePrice: item.value,
              currency: "PCT",
            });
          }
        }
      }

      if (!anySuccess) {
        // Touch updatedAt on existing sync row so cooldown prevents immediate retry storm
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

      if (rowsToInsert.length > 0) {
        await prisma.historicalQuoteCache.createMany({
          data: rowsToInsert,
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

  for (const r of syncResults) {
    if (r.status === "fulfilled" && r.value) {
      fetchedSeriesCount++;
    }
  }

  return fetchedSeriesCount;
}

/**
 * Fetches historical BCB series (Selic target % p.a., CDI % p.a., and monthly IPCA %)
 * over [startDate, endDate] with incremental caching, single-roundtrip warm reads,
 * 6h retry cooldown, and SWR background sync.
 */
export async function getHistoricalFixedIncomeBenchmarks(params: {
  startDate: string;
  endDate: string;
  forceRefresh?: boolean;
  deferBackgroundRefresh?: boolean;
  onBackgroundRefreshComplete?: () => void;
}): Promise<{
  rates: HistoricalBenchmarkRates;
  benchmarks: BenchmarkRates;
  fetchedSeriesCount: number;
  hasStaleRates: boolean;
}> {
  const {
    startDate,
    endDate,
    forceRefresh = false,
    deferBackgroundRefresh = false,
    onBackgroundRefreshComplete,
  } = params;

  if (!startDate || !endDate || startDate > endDate) {
    const fallbackBenchmarks = await getFixedIncomeBenchmarks({
      forceRefresh,
      deferBackgroundRefresh,
      onBackgroundRefreshComplete,
    });
    return {
      rates: {
        selicAnnualPct: {},
        cdiAnnualPct: {},
        ipcaMonthlyPct: {},
        fallback: {
          selic: fallbackBenchmarks.selic,
          cdi: fallbackBenchmarks.cdi,
          ipca: fallbackBenchmarks.ipca,
        },
      },
      benchmarks: fallbackBenchmarks,
      fetchedSeriesCount: 0,
      hasStaleRates: false,
    };
  }

  // Pad by 45 days before startDate for carry-forward (including prior month IPCA)
  const paddedStart = addDaysISO(startDate, -45);

  // Read benchmark cache, historical sync metadata, and cached daily series in ONE parallel DB roundtrip
  const [benchmarkRows, syncRows, initialCachedRows] = await Promise.all([
    prisma.quoteCache.findMany({
      where: { symbol: { in: BENCHMARK_SYMBOLS } },
    }),
    prisma.historicalQuoteSync.findMany({
      where: { symbol: { in: HIST_SYMBOL_LIST } },
    }),
    prisma.historicalQuoteCache.findMany({
      where: {
        symbol: { in: HIST_SYMBOL_LIST },
        date: { gte: paddedStart, lte: endDate },
      },
      select: {
        symbol: true,
        date: true,
        closePrice: true,
      },
    }),
  ]);

  const now = Date.now();
  const benchmarkMap = new Map<string, QuoteCacheRow>(
    benchmarkRows.map((r) => [r.symbol, r])
  );
  const hasAllBenchmarks = BENCHMARK_SYMBOLS.every((sym) =>
    benchmarkMap.has(sym)
  );
  const areBenchmarksFresh =
    hasAllBenchmarks &&
    BENCHMARK_SYMBOLS.every(
      (sym) => now - benchmarkMap.get(sym)!.updatedAt.getTime() <= CACHE_TTL_MS
    );

  const needSyncBenchmarks = forceRefresh || !hasAllBenchmarks;
  const needBgBenchmarks = !forceRefresh && hasAllBenchmarks && !areBenchmarksFresh;

  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));
  const { syncJobs, backgroundJobs } = planHistoricalSeriesJobs({
    syncMap,
    paddedStart,
    endDate,
    forceRefresh,
    now,
  });

  const timeoutMs = forceRefresh ? BG_FETCH_TIMEOUT_MS : SYNC_FETCH_TIMEOUT_MS;

  const [benchmarkResult, fetchedSeriesCount] = await Promise.all([
    needSyncBenchmarks
      ? fetchAndPersistBenchmarks(benchmarkMap, timeoutMs).then((r) => r.rates)
      : Promise.resolve(buildBenchmarkRatesFromMap(benchmarkMap, "cache")),
    executeHistoricalSeriesJobs({
      jobs: syncJobs,
      paddedStart,
      endDate,
      forceRefresh,
      timeoutMs,
    }),
  ]);

  const cachedRows =
    fetchedSeriesCount > 0
      ? await prisma.historicalQuoteCache.findMany({
          where: {
            symbol: { in: HIST_SYMBOL_LIST },
            date: { gte: paddedStart, lte: endDate },
          },
          select: {
            symbol: true,
            date: true,
            closePrice: true,
          },
        })
      : initialCachedRows;

  const hasStaleRates = needBgBenchmarks || backgroundJobs.length > 0;

  if (hasStaleRates && !deferBackgroundRefresh) {
    scheduleBackgroundWork(async () => {
      const [bgBench, bgHistCount] = await Promise.all([
        needBgBenchmarks
          ? fetchAndPersistBenchmarks(
              new Map(benchmarkMap),
              BG_FETCH_TIMEOUT_MS
            )
          : Promise.resolve({ updatedCount: 0 }),
        executeHistoricalSeriesJobs({
          jobs: backgroundJobs,
          paddedStart,
          endDate,
          forceRefresh: false,
          timeoutMs: BG_FETCH_TIMEOUT_MS,
        }),
      ]);
      if (bgBench.updatedCount > 0 || bgHistCount > 0) {
        onBackgroundRefreshComplete?.();
      }
    });
  }

  const selicAnnualPct: Record<string, number> = {};
  const cdiAnnualPct: Record<string, number> = {};
  const ipcaMonthlyPct: Record<string, number> = {};

  for (const row of cachedRows) {
    const val = Number(row.closePrice);
    if (!Number.isFinite(val)) continue;
    if (row.symbol === HIST_SYMBOL_SELIC) {
      selicAnnualPct[row.date] = val;
    } else if (row.symbol === HIST_SYMBOL_CDI) {
      cdiAnnualPct[row.date] = val;
    } else if (row.symbol === HIST_SYMBOL_IPCA) {
      ipcaMonthlyPct[row.date.slice(0, 7)] = val;
    }
  }

  return {
    rates: {
      selicAnnualPct,
      cdiAnnualPct,
      ipcaMonthlyPct,
      fallback: {
        selic: benchmarkResult.selic,
        cdi: benchmarkResult.cdi,
        ipca: benchmarkResult.ipca,
      },
    },
    benchmarks: benchmarkResult,
    fetchedSeriesCount,
    hasStaleRates,
  };
}

/**
 * Background helper to refresh stale BCB benchmarks and historical series.
 */
export async function refreshStaleFixedIncomeBenchmarks(params: {
  startDate: string;
  endDate: string;
}): Promise<number> {
  const { startDate, endDate } = params;
  const paddedStart = addDaysISO(startDate, -45);
  const [benchmarkRows, syncRows] = await Promise.all([
    prisma.quoteCache.findMany({
      where: { symbol: { in: BENCHMARK_SYMBOLS } },
    }),
    prisma.historicalQuoteSync.findMany({
      where: { symbol: { in: HIST_SYMBOL_LIST } },
    }),
  ]);

  const now = Date.now();
  const benchmarkMap = new Map<string, QuoteCacheRow>(
    benchmarkRows.map((r) => [r.symbol, r])
  );
  const needBenchmarks = BENCHMARK_SYMBOLS.some((sym) => {
    const row = benchmarkMap.get(sym);
    return !row || now - row.updatedAt.getTime() > CACHE_TTL_MS;
  });

  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));
  const { syncJobs, backgroundJobs } = planHistoricalSeriesJobs({
    syncMap,
    paddedStart,
    endDate,
    forceRefresh: false,
    now,
  });

  const [benchRes, histCount] = await Promise.all([
    needBenchmarks
      ? fetchAndPersistBenchmarks(benchmarkMap, BG_FETCH_TIMEOUT_MS)
      : Promise.resolve({ updatedCount: 0 }),
    executeHistoricalSeriesJobs({
      jobs: [...syncJobs, ...backgroundJobs],
      paddedStart,
      endDate,
      forceRefresh: false,
      timeoutMs: BG_FETCH_TIMEOUT_MS,
    }),
  ]);

  return benchRes.updatedCount + histCount;
}
