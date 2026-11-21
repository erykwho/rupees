import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
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

export async function getQuotesForAssets(
  assets: QuoteAssetInput[],
  options: { forceRefresh?: boolean } = {}
): Promise<QuotesResult> {
  const { forceRefresh = false } = options;

  const symbols = new Set<string>([USD_BRL_SYMBOL]);
  const symbolToAssetClass = new Map<string, AssetClassKey>();
  const forceCheckSymbols = new Set<string>();

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
        forceCheckSymbols.add(sym);
      }
    }
  }

  const symbolList = Array.from(symbols);
  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: symbolList } },
  });

  const now = Date.now();
  const cachedMap = new Map(cachedRows.map((r) => [r.symbol, r]));
  const staleSymbols = symbolList.filter((sym) => {
    if (forceRefresh) return true;
    if (forceCheckSymbols.has(sym)) return true;
    const cached = cachedMap.get(sym);
    if (!cached) return true;
    return now - cached.updatedAt.getTime() > CACHE_TTL_MS;
  });

  let refreshedCount = 0;
  let outcomes: Record<string, BatchSymbolResult> = {};

  if (staleSymbols.length > 0) {
    outcomes = await fetchYahooQuotesBatch(staleSymbols, symbolToAssetClass);
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

    if (upserts.length > 0) {
      const updated = await Promise.allSettled(upserts);
      for (const res of updated) {
        if (res.status === "fulfilled") {
          cachedMap.set(res.value.symbol, res.value);
          refreshedCount++;
        }
      }
    }
  }

  // Unified automatic validation status update for variable-income assets
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
  };
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
    const item = (await yahooFinance.quote(sym)) as
      | RawYahooQuote
      | null
      | undefined;
    return classifySingleQuote(sym, item, expectedClass);
  } catch (err) {
    if (isYahooNotFoundError(err)) {
      return { outcome: "INVALID" };
    }
    return { outcome: "UNAVAILABLE" };
  }
}

async function fetchYahooQuotesBatch(
  symbols: string[],
  symbolToAssetClass: Map<string, AssetClassKey>
): Promise<Record<string, BatchSymbolResult>> {
  const result: Record<string, BatchSymbolResult> = {};

  // Fetch in small chunks to avoid Yahoo Finance rate limits
  const chunkSize = 15;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const raw = await yahooFinance.quote(chunk);
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

  return result;
}
