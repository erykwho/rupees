import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
import {
  type AssetClassKey,
  getYahooSymbol,
} from "@/lib/domain/types";
import type { QuoteMapEntry } from "@/lib/domain/calculations";

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const USD_BRL_SYMBOL = "USDBRL=X";
const DEFAULT_USD_BRL = 5.5;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface QuotesResult {
  quotes: Record<string, QuoteMapEntry>;
  usdBrl: number;
  usdBrlUpdatedAt: string | null;
  refreshedCount: number;
}

export async function getQuotesForAssets(
  assets: Array<{ ticker: string; assetClass: AssetClassKey; priceMode: string }>,
  options: { forceRefresh?: boolean } = {}
): Promise<QuotesResult> {
  const { forceRefresh = false } = options;

  const symbols = new Set<string>([USD_BRL_SYMBOL]);
  for (const asset of assets) {
    if (asset.priceMode !== "AUTO_YAHOO") continue;
    const sym = getYahooSymbol(asset.ticker, asset.assetClass);
    if (sym) symbols.add(sym);
  }

  const symbolList = Array.from(symbols);
  const cachedRows = await prisma.quoteCache.findMany({
    where: { symbol: { in: symbolList } },
  });

  const now = Date.now();
  const cachedMap = new Map(cachedRows.map((r) => [r.symbol, r]));
  const staleSymbols = symbolList.filter((sym) => {
    if (forceRefresh) return true;
    const cached = cachedMap.get(sym);
    if (!cached) return true;
    return now - cached.updatedAt.getTime() > CACHE_TTL_MS;
  });

  let refreshedCount = 0;

  if (staleSymbols.length > 0) {
    const fetched = await fetchYahooQuotesBatch(staleSymbols);
    const upserts = [];

    for (const [sym, data] of Object.entries(fetched)) {
      if (data.price > 0) {
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

  const quotes: Record<string, QuoteMapEntry> = {};
  for (const [sym, row] of cachedMap.entries()) {
    quotes[sym] = {
      price: Number(row.price),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  const usdRow = cachedMap.get(USD_BRL_SYMBOL);
  const usdBrl = usdRow && Number(usdRow.price) > 0 ? Number(usdRow.price) : DEFAULT_USD_BRL;
  const usdBrlUpdatedAt = usdRow ? usdRow.updatedAt.toISOString() : null;

  return {
    quotes,
    usdBrl,
    usdBrlUpdatedAt,
    refreshedCount,
  };
}

async function fetchYahooQuotesBatch(
  symbols: string[]
): Promise<Record<string, { price: number; currency: string }>> {
  const result: Record<string, { price: number; currency: string }> = {};

  // Fetch in small chunks to avoid Yahoo Finance rate limits
  const chunkSize = 15;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const raw = await yahooFinance.quote(chunk);
      const list = Array.isArray(raw) ? raw : [raw];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const symbol = (item as { symbol?: string }).symbol;
        const price =
          (item as { regularMarketPrice?: number }).regularMarketPrice ??
          (item as { postMarketPrice?: number }).postMarketPrice ??
          (item as { regularMarketPreviousClose?: number })
            .regularMarketPreviousClose;
        const currency =
          (item as { currency?: string }).currency ??
          (symbol?.endsWith(".SA") ? "BRL" : "USD");

        if (symbol && typeof price === "number" && Number.isFinite(price) && price > 0) {
          result[symbol] = { price, currency };
        }
      }
    } catch {
      // Fallback: fetch individually so one invalid ticker doesn't break the whole batch
      await Promise.allSettled(
        chunk.map(async (sym) => {
          try {
            const item = await yahooFinance.quote(sym);
            const price =
              (item as { regularMarketPrice?: number })?.regularMarketPrice ??
              (item as { regularMarketPreviousClose?: number })
                ?.regularMarketPreviousClose;
            const currency =
              (item as { currency?: string })?.currency ??
              (sym.endsWith(".SA") ? "BRL" : "USD");
            if (typeof price === "number" && Number.isFinite(price) && price > 0) {
              result[sym] = { price, currency };
            }
          } catch {
            // Keep fallback to DB cache
          }
        })
      );
    }
  }

  return result;
}
