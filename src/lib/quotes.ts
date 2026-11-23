import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
import { scheduleBackgroundWork } from "@/lib/background-work";
import {
  type AssetClassKey,
  type TickerValidationStatusKey,
  getYahooSymbol,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import {
  type ValidationOutcome,
  matchesExpectedExchange,
  resolveValidationStatusTransition,
} from "@/lib/domain/ticker-validation";
import {
  extractYahooPrice,
  isYahooNotFoundError,
} from "@/lib/ticker-validator";
import type { QuoteMapEntry } from "@/lib/domain/calculations";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const YAHOO_QUOTE_TIMEOUT_MS = 4500;
const CHUNK_SIZE = 15;
const MAX_PARALLEL_CHUNKS = 3;
const USD_BRL_SYMBOL = "USDBRL=X";
const DEFAULT_USD_BRL = 5.5;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface QuoteAssetInput {
  id?: string;
  ticker: string;
  assetClass: AssetClassKey;
  priceMode: string;
  tickerValidationStatus?: TickerValidationStatusKey;
}

export interface QuotesResult {
  quotes: Record<string, QuoteMapEntry>;
  usdBrl: number;
  usdBrlUpdatedAt: string | null;
  refreshedCount: number;
  updatedStatuses: Record<string, TickerValidationStatusKey>;
  hasStaleQuotes: boolean;
}

type RawYahooQuote = {
  symbol?: string;
  exchange?: string;
  fullExchangeName?: string;
  quoteType?: string;
  currency?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  postMarketPrice?: number;
  regularMarketPreviousClose?: number;
};

type BatchSymbolResult =
  | { outcome: "VALID"; price: number; currency: string }
  | { outcome: "INVALID" }
  | { outcome: "UNAVAILABLE" };

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Yahoo quote timeout after ${timeoutMs}ms`));
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

function collectSymbolMetadata(assets: QuoteAssetInput[]) {
  const symbols = new Set<string>([USD_BRL_SYMBOL]);
  const symbolToAssetClass = new Map<string, AssetClassKey>();
  const unverifiedSymbols = new Set<string>();

  for (const asset of assets) {
    if (!isVariableIncomeClass(asset.assetClass)) continue;
    const sym = getYahooSymbol(asset.ticker, asset.assetClass);
    if (!sym) continue;

    const needsValidationCheck =
      asset.tickerValidationStatus !== undefined &&
      asset.tickerValidationStatus !== "VERIFIED";

    if (asset.priceMode === "AUTO_YAHOO" || needsValidationCheck) {
      symbols.add(sym);
      symbolToAssetClass.set(sym, asset.assetClass);
      if (needsValidationCheck) {
        unverifiedSymbols.add(sym);
      }
    }
  }

  return {
    symbolList: Array.from(symbols),
    symbolToAssetClass,
    unverifiedSymbols,
  };
}

async function persistQuoteOutcomes(params: {
  assets: QuoteAssetInput[];
  outcomes: Record<string, BatchSymbolResult>;
  cachedMap?: Map<string, { symbol: string; price: unknown; currency: string; updatedAt: Date }>;
}): Promise<{
  refreshedCount: number;
  updatedStatuses: Record<string, TickerValidationStatusKey>;
}> {
  const { assets, outcomes, cachedMap } = params;
  const upserts = [];

  for (const [sym, data] of Object.entries(outcomes)) {
    if (data.outcome === "VALID" && data.price > 0) {
      upserts.push(
        prisma.quoteCache.upsert({
          where: { symbol: sym },
          update: {
            price: data.price,
            currency: data.currency,
          },
          create: {
            symbol: sym,
            price: data.price,
            currency: data.currency,
          },
        })
      );
    }
  }

  let refreshedCount = 0;
  if (upserts.length > 0) {
    const updated = await Promise.allSettled(upserts);
    for (const res of updated) {
      if (res.status === "fulfilled") {
        cachedMap?.set(res.value.symbol, res.value);
        refreshedCount++;
      }
    }
  }

  const updatedStatuses: Record<string, TickerValidationStatusKey> = {};
  const toVerifyIds: string[] = [];
  const toInvalidateIds: string[] = [];

  for (const asset of assets) {
    if (!asset.id || !isVariableIncomeClass(asset.assetClass)) continue;
    const sym = getYahooSymbol(asset.ticker, asset.assetClass);
    if (!sym) continue;

    const currentStatus: TickerValidationStatusKey =
      asset.tickerValidationStatus ?? "VERIFIED";
    const result = outcomes[sym];
    if (!result) {
      updatedStatuses[asset.id] = currentStatus;
      continue;
    }

    const nextStatus = resolveValidationStatusTransition(
      currentStatus,
      result.outcome as ValidationOutcome
    );
    updatedStatuses[asset.id] = nextStatus;

    if (nextStatus !== currentStatus) {
      if (nextStatus === "VERIFIED") toVerifyIds.push(asset.id);
      else if (nextStatus === "INVALID") toInvalidateIds.push(asset.id);
    }
  }

  if (toVerifyIds.length > 0 || toInvalidateIds.length > 0) {
    const statusUpdates = [];
    if (toVerifyIds.length > 0) {
      statusUpdates.push(
        prisma.asset.updateMany({
          where: { id: { in: toVerifyIds } },
          data: { tickerValidationStatus: "VERIFIED" },
        })
      );
    }
    if (toInvalidateIds.length > 0) {
      statusUpdates.push(
        prisma.asset.updateMany({
          where: { id: { in: toInvalidateIds } },
          data: { tickerValidationStatus: "INVALID" },
        })
      );
    }
    await Promise.allSettled(statusUpdates);
  }

  return { refreshedCount, updatedStatuses };
}

export async function getQuotesForAssets(
  assets: QuoteAssetInput[],
  options: {
    forceRefresh?: boolean;
    deferBackgroundRefresh?: boolean;
    onBackgroundRefreshComplete?: () => void;
  } = {}
): Promise<QuotesResult> {
  const {
    forceRefresh = false,
    deferBackgroundRefresh = false,
    onBackgroundRefreshComplete,
  } = options;

  const { symbolList, symbolToAssetClass, unverifiedSymbols } =
    collectSymbolMetadata(assets);

  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: symbolList } },
  });

  const now = Date.now();
  const cachedMap = new Map(cachedRows.map((r) => [r.symbol, r]));

  // Symbols to fetch synchronously (blocking) vs in the background (SWR)
  const syncFetchSymbols: string[] = [];
  const bgRefreshSymbols: string[] = [];

  for (const sym of symbolList) {
    const cached = cachedMap.get(sym);
    const isExpired = !cached || now - cached.updatedAt.getTime() > CACHE_TTL_MS;
    const isUnverified = unverifiedSymbols.has(sym);

    if (forceRefresh) {
      syncFetchSymbols.push(sym);
      continue;
    }

    if (!cached) {
      // Avoid blocking SSR on every visit for assets already known as PENDING/INVALID
      if (isUnverified) {
        bgRefreshSymbols.push(sym);
      } else {
        syncFetchSymbols.push(sym);
      }
      continue;
    }

    if (isExpired) {
      // Stale-while-revalidate: serve cached quote immediately and refresh in background
      bgRefreshSymbols.push(sym);
    }
  }

  let refreshedCount = 0;
  let updatedStatuses: Record<string, TickerValidationStatusKey> = {};

  if (syncFetchSymbols.length > 0) {
    const outcomes = await fetchYahooQuotesBatch(
      syncFetchSymbols,
      symbolToAssetClass
    );
    const persisted = await persistQuoteOutcomes({
      assets,
      outcomes,
      cachedMap,
    });
    refreshedCount = persisted.refreshedCount;
    updatedStatuses = persisted.updatedStatuses;
  } else {
    for (const asset of assets) {
      if (!asset.id || !isVariableIncomeClass(asset.assetClass)) continue;
      updatedStatuses[asset.id] = asset.tickerValidationStatus ?? "VERIFIED";
    }
  }

  const hasStaleQuotes = bgRefreshSymbols.length > 0;

  if (hasStaleQuotes && !deferBackgroundRefresh) {
    scheduleBackgroundWork(async () => {
      const outcomes = await fetchYahooQuotesBatch(
        bgRefreshSymbols,
        symbolToAssetClass
      );
      const persisted = await persistQuoteOutcomes({ assets, outcomes });
      if (persisted.refreshedCount > 0) {
        onBackgroundRefreshComplete?.();
      }
    });
  }

  const quotes: Record<string, QuoteMapEntry> = {};
  for (const [sym, row] of cachedMap.entries()) {
    quotes[sym] = {
      price: Number(row.price),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  const usdRow = cachedMap.get(USD_BRL_SYMBOL);
  const usdBrl =
    usdRow && Number(usdRow.price) > 0 ? Number(usdRow.price) : DEFAULT_USD_BRL;
  const usdBrlUpdatedAt = usdRow ? usdRow.updatedAt.toISOString() : null;

  return {
    quotes,
    usdBrl,
    usdBrlUpdatedAt,
    refreshedCount,
    updatedStatuses,
    hasStaleQuotes,
  };
}

/**
 * Refreshes stale or unverified quotes in the background without blocking navigation.
 */
export async function refreshStaleQuotesForAssets(
  assets: QuoteAssetInput[]
): Promise<number> {
  const { symbolList, symbolToAssetClass, unverifiedSymbols } =
    collectSymbolMetadata(assets);

  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: symbolList } },
  });
  const now = Date.now();
  const cachedMap = new Map(cachedRows.map((r) => [r.symbol, r]));

  const toRefresh = symbolList.filter((sym) => {
    const cached = cachedMap.get(sym);
    if (!cached) return true;
    if (now - cached.updatedAt.getTime() > CACHE_TTL_MS) return true;
    return unverifiedSymbols.has(sym);
  });

  if (toRefresh.length === 0) return 0;

  const outcomes = await fetchYahooQuotesBatch(toRefresh, symbolToAssetClass);
  const persisted = await persistQuoteOutcomes({ assets, outcomes });
  return persisted.refreshedCount;
}

function classifySingleQuote(
  sym: string,
  item: RawYahooQuote | null | undefined,
  expectedClass: AssetClassKey | undefined
): BatchSymbolResult {
  if (!item || typeof item !== "object" || !item.symbol) {
    return { outcome: "INVALID" };
  }

  if (expectedClass) {
    const exchangeOk = matchesExpectedExchange(expectedClass, {
      symbol: item.symbol,
      exchange: item.exchange,
      exchDisp: item.fullExchangeName,
      quoteType: item.quoteType,
      currency: item.currency,
      shortName: item.shortName,
      longName: item.longName,
    });
    if (!exchangeOk) {
      return { outcome: "INVALID" };
    }
  }

  const price = extractYahooPrice(item);
  if (price === null) {
    return { outcome: "INVALID" };
  }

  const currency = item.currency ?? (sym.endsWith(".SA") ? "BRL" : "USD");
  return { outcome: "VALID", price, currency };
}

async function fetchSingleYahooQuote(
  sym: string,
  expectedClass: AssetClassKey | undefined
): Promise<BatchSymbolResult> {
  try {
    const item = (await withTimeout(
      yahooFinance.quote(sym),
      YAHOO_QUOTE_TIMEOUT_MS
    )) as RawYahooQuote | null | undefined;
    return classifySingleQuote(sym, item, expectedClass);
  } catch (err) {
    if (isYahooNotFoundError(err)) {
      return { outcome: "INVALID" };
    }
    return { outcome: "UNAVAILABLE" };
  }
}

async function fetchChunk(
  chunk: string[],
  symbolToAssetClass: Map<string, AssetClassKey>,
  result: Record<string, BatchSymbolResult>
): Promise<void> {
  try {
    const raw = await withTimeout(
      yahooFinance.quote(chunk),
      YAHOO_QUOTE_TIMEOUT_MS
    );
    const list = (Array.isArray(raw) ? raw : [raw]) as Array<
      RawYahooQuote | null | undefined
    >;
    const seen = new Set<string>();

    for (const item of list) {
      if (!item || typeof item !== "object" || !item.symbol) continue;
      const sym = item.symbol;
      seen.add(sym.toUpperCase());
      result[sym] = classifySingleQuote(
        sym,
        item,
        symbolToAssetClass.get(sym)
      );
    }

    // Any symbol omitted from a successful batch response is double-checked individually
    const missing = chunk.filter((sym) => !seen.has(sym.toUpperCase()));
    if (missing.length > 0) {
      await Promise.allSettled(
        missing.map(async (sym) => {
          result[sym] = await fetchSingleYahooQuote(
            sym,
            symbolToAssetClass.get(sym)
          );
        })
      );
    }
  } catch {
    // Fallback: fetch individually so one invalid ticker doesn't break the whole batch
    await Promise.allSettled(
      chunk.map(async (sym) => {
        result[sym] = await fetchSingleYahooQuote(
          sym,
          symbolToAssetClass.get(sym)
        );
      })
    );
  }
}

async function fetchYahooQuotesBatch(
  symbols: string[],
  symbolToAssetClass: Map<string, AssetClassKey>
): Promise<Record<string, BatchSymbolResult>> {
  const result: Record<string, BatchSymbolResult> = {};
  const chunks: string[][] = [];

  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    chunks.push(symbols.slice(i, i + CHUNK_SIZE));
  }

  for (let i = 0; i < chunks.length; i += MAX_PARALLEL_CHUNKS) {
    const wave = chunks.slice(i, i + MAX_PARALLEL_CHUNKS);
    await Promise.allSettled(
      wave.map((chunk) => fetchChunk(chunk, symbolToAssetClass, result))
    );
  }

  return result;
}
