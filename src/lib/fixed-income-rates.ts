import { prisma } from "@/lib/prisma";
import type { BenchmarkRates } from "@/lib/domain/fixed-income";

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
