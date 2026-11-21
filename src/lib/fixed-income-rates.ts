import { prisma } from "@/lib/prisma";
import type {
  BenchmarkRates,
  HistoricalBenchmarkRates,
} from "@/lib/domain/fixed-income";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
const FETCH_TIMEOUT_MS = 6000;

const SYMBOL_SELIC = "BCB:SELIC";
const SYMBOL_CDI = "BCB:CDI";
const SYMBOL_IPCA = "BCB:IPCA12M";

const DEFAULT_SELIC = 14.25;
const DEFAULT_CDI = 14.15;
const DEFAULT_IPCA = 4.5;

interface BcbSgsEntry {
  data: string;
  valor: string;
}

async function fetchBcbSeries(
  seriesCode: number,
  lastN: number
): Promise<BcbSgsEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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

/**
 * Busca taxas de referência brasileiras (Selic meta, CDI anualizado e IPCA acumulado 12m)
 * na API pública do Banco Central (SGS), com cache de 12h em QuoteCache e fallback seguro.
 */
export async function getFixedIncomeBenchmarks(
  options: { forceRefresh?: boolean } = {}
): Promise<BenchmarkRates> {
  const { forceRefresh = false } = options;
  const symbols = [SYMBOL_SELIC, SYMBOL_CDI, SYMBOL_IPCA];

  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: symbols } },
  });

  const now = Date.now();
  const cachedMap = new Map(cachedRows.map((r) => [r.symbol, r]));

  const isFresh =
    !forceRefresh &&
    symbols.every((sym) => {
      const row = cachedMap.get(sym);
      return row && now - row.updatedAt.getTime() <= CACHE_TTL_MS;
    });

  if (isFresh) {
    const selicRow = cachedMap.get(SYMBOL_SELIC)!;
    const cdiRow = cachedMap.get(SYMBOL_CDI)!;
    const ipcaRow = cachedMap.get(SYMBOL_IPCA)!;
    return {
      selic: round2(Number(selicRow.price)),
      cdi: round2(Number(cdiRow.price)),
      ipca: round2(Number(ipcaRow.price)),
      updatedAt: selicRow.updatedAt.toISOString(),
      source: "cache",
    };
  }

  // Série 432: Taxa de juros - Meta Selic definida pelo Copom (% a.a.)
  // Série 4389: Taxa de juros - CDI anualizada base 252 (% a.a.)
  // Série 433: IPCA - variação mensal (%) -> últimos 12 meses compostos
  const [selicData, cdiData, ipcaData] = await Promise.all([
    fetchBcbSeries(432, 1),
    fetchBcbSeries(4389, 1),
    fetchBcbSeries(433, 12),
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
      }
    }
  }

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

  const source: BenchmarkRates["source"] =
    upserts.length > 0 ? "bcb" : latestUpdatedAt ? "cache" : "fallback";

  return {
    selic,
    cdi,
    ipca,
    updatedAt: latestUpdatedAt,
    source,
  };
}

const HIST_SYMBOL_SELIC = "BCB:HIST:SELIC";
const HIST_SYMBOL_CDI = "BCB:HIST:CDI";
const HIST_SYMBOL_IPCA = "BCB:HIST:IPCA";
const MAX_BCB_WINDOW_DAYS = 1800; // ~5 anos (BCB limita séries diárias a 10 anos)

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
  toISO: string
): Promise<BcbSgsEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
  toISO: string
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
      effectiveEnd
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

/**
 * Busca séries históricas do Banco Central (Selic meta % a.a., CDI % a.a. e IPCA % mensal)
 * no período [startDate, endDate], com cache incremental em HistoricalQuoteCache e fallback
 * para as taxas atuais.
 */
export async function getHistoricalFixedIncomeBenchmarks(params: {
  startDate: string;
  endDate: string;
  forceRefresh?: boolean;
}): Promise<{
  rates: HistoricalBenchmarkRates;
  fetchedSeriesCount: number;
}> {
  const { startDate, endDate, forceRefresh = false } = params;

  const fallbackBenchmarks = await getFixedIncomeBenchmarks({ forceRefresh });
  const fallback = {
    selic: fallbackBenchmarks.selic,
    cdi: fallbackBenchmarks.cdi,
    ipca: fallbackBenchmarks.ipca,
  };

  if (!startDate || !endDate || startDate > endDate) {
    return {
      rates: {
        selicAnnualPct: {},
        cdiAnnualPct: {},
        ipcaMonthlyPct: {},
        fallback,
      },
      fetchedSeriesCount: 0,
    };
  }

  // Pad de 45 dias antes de startDate para garantir carry-forward (inclusive IPCA mensal anterior)
  const paddedStart = addDaysISO(startDate, -45);

  const seriesConfigs = [
    { symbol: HIST_SYMBOL_SELIC, code: 432, isMonthly: false },
    { symbol: HIST_SYMBOL_CDI, code: 4389, isMonthly: false },
    { symbol: HIST_SYMBOL_IPCA, code: 433, isMonthly: true },
  ];
  const symbolList = seriesConfigs.map((s) => s.symbol);

  const syncRows = await prisma.historicalQuoteSync.findMany({
    where: { symbol: { in: symbolList } },
  });
  const syncMap = new Map(syncRows.map((r) => [r.symbol, r]));

  let fetchedSeriesCount = 0;

  const syncResults = await Promise.allSettled(
    seriesConfigs.map(async (cfg) => {
      const sync = syncMap.get(cfg.symbol);
      const ranges: Array<{ from: string; to: string }> = [];
      let newCoveredFrom = paddedStart;
      let newCoveredTo = endDate;

      if (forceRefresh || !sync) {
        ranges.push({ from: paddedStart, to: endDate });
      } else {
        newCoveredFrom =
          paddedStart < sync.coveredFrom ? paddedStart : sync.coveredFrom;
        newCoveredTo = endDate > sync.coveredTo ? endDate : sync.coveredTo;

        if (paddedStart < sync.coveredFrom) {
          ranges.push({ from: paddedStart, to: sync.coveredFrom });
        }
        if (endDate > sync.coveredTo) {
          // Para IPCA mensal, rebusca os últimos 60 dias para capturar divulgações recentes
          const tailStart = cfg.isMonthly
            ? addDaysISO(sync.coveredTo, -60)
            : sync.coveredTo;
          ranges.push({ from: tailStart, to: endDate });
        }
      }

      if (ranges.length === 0) return false;

      const rowsToInsert: Array<{
        symbol: string;
        date: string;
        closePrice: number;
        currency: string;
      }> = [];
      let anySuccess = false;

      for (const range of ranges) {
        const fetched = await fetchBcbSeriesRange(
          cfg.code,
          range.from,
          range.to
        );
        if (fetched !== null) {
          anySuccess = true;
          for (const item of fetched) {
            rowsToInsert.push({
              symbol: cfg.symbol,
              date: item.date,
              closePrice: item.value,
              currency: "PCT",
            });
          }
        }
      }

      if (!anySuccess) return false;

      if (forceRefresh) {
        await prisma.historicalQuoteCache.deleteMany({
          where: {
            symbol: cfg.symbol,
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
        where: { symbol: cfg.symbol },
        update: {
          coveredFrom: newCoveredFrom,
          coveredTo: newCoveredTo,
        },
        create: {
          symbol: cfg.symbol,
          coveredFrom: newCoveredFrom,
          coveredTo: newCoveredTo,
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
      fallback,
    },
    fetchedSeriesCount,
  };
}
