import YahooFinance from "yahoo-finance2";
import { prisma } from "@/lib/prisma";
import {
  type AssetClassKey,
  getYahooSymbol,
  isFixedIncomeClass,
} from "@/lib/domain/types";
import {
  formatExchangeLabel,
  getExpectedExchangeLabel,
  isTickerFormatValid,
  matchesExpectedExchange,
  normalizeTicker,
} from "@/lib/domain/ticker-validation";

const YAHOO_TIMEOUT_MS = 6500;

const yahooFinance = new YahooFinance({
  suppressNotices: ["yahooSurvey"],
});

export interface TickerSearchResult {
  ticker: string;
  yahooSymbol: string;
  name: string;
  exchange: string;
  quoteType: string;
  currency: string;
  price?: number | null;
}

export interface TickerSearchResponse {
  results: TickerSearchResult[];
  unavailable: boolean;
}

export interface TickerValidationResult {
  status: "VALID" | "INVALID" | "UNAVAILABLE";
  normalizedTicker: string;
  yahooSymbol: string | null;
  name?: string;
  exchange?: string;
  price?: number;
  currency?: string;
  reason?: string;
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

type RawYahooSearchQuote = {
  symbol?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
  shortname?: string;
  longname?: string;
  isYahooFinance?: boolean;
};

export function extractYahooPrice(item: RawYahooQuote | null | undefined): number | null {
  if (!item || typeof item !== "object") return null;
  const price =
    item.regularMarketPrice ??
    item.postMarketPrice ??
    item.regularMarketPreviousClose;
  if (typeof price === "number" && Number.isFinite(price) && price > 0) {
    return price;
  }
  return null;
}

export function isYahooNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  return (
    message.includes("not found") ||
    message.includes("no data found") ||
    message.includes("quote not found") ||
    message.includes("404") ||
    message.includes("delisted")
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("YAHOO_TIMEOUT")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function validateTickerOnYahoo(
  rawTicker: string,
  assetClass: AssetClassKey
): Promise<TickerValidationResult> {
  const normalizedTicker = normalizeTicker(rawTicker, assetClass);

  if (isFixedIncomeClass(assetClass)) {
    return {
      status: "VALID",
      normalizedTicker,
      yahooSymbol: null,
    };
  }

  if (!isTickerFormatValid(normalizedTicker, assetClass)) {
    return {
      status: "INVALID",
      normalizedTicker,
      yahooSymbol: null,
      reason: `Formato de ticker inválido para ${getExpectedExchangeLabel(assetClass)}.`,
    };
  }

  const yahooSymbol = getYahooSymbol(normalizedTicker, assetClass);
  if (!yahooSymbol) {
    return {
      status: "INVALID",
      normalizedTicker,
      yahooSymbol: null,
      reason: "Ticker inválido.",
    };
  }

  try {
    const raw = (await withTimeout(
      yahooFinance.quote(yahooSymbol),
      YAHOO_TIMEOUT_MS
    )) as RawYahooQuote | null | undefined;

    if (!raw || typeof raw !== "object" || !raw.symbol) {
      return {
        status: "INVALID",
        normalizedTicker,
        yahooSymbol,
        reason: `Ticker "${normalizedTicker}" não encontrado em ${getExpectedExchangeLabel(assetClass)}.`,
      };
    }

    const validExchange = matchesExpectedExchange(assetClass, {
      symbol: raw.symbol,
      exchange: raw.exchange,
      exchDisp: raw.fullExchangeName,
      quoteType: raw.quoteType,
      currency: raw.currency,
      shortName: raw.shortName,
      longName: raw.longName,
    });

    if (!validExchange) {
      return {
        status: "INVALID",
        normalizedTicker,
        yahooSymbol,
        reason: `Ticker "${normalizedTicker}" não pertence a ${getExpectedExchangeLabel(assetClass)}.`,
      };
    }

    const price = extractYahooPrice(raw);
    if (price === null) {
      return {
        status: "INVALID",
        normalizedTicker,
        yahooSymbol,
        reason: `Ticker "${normalizedTicker}" não possui cotação ativa em ${getExpectedExchangeLabel(assetClass)}.`,
      };
    }

    const currency =
      raw.currency ?? (yahooSymbol.endsWith(".SA") ? "BRL" : "USD");

    // Warm the QuoteCache so the newly added/edited asset has a fresh quote right away
    try {
      await prisma.quoteCache.upsert({
        where: { symbol: yahooSymbol },
        update: { price, currency },
        create: { symbol: yahooSymbol, price, currency },
      });
    } catch {
      // Non-fatal: cache write failure shouldn't block validation
    }

    return {
      status: "VALID",
      normalizedTicker,
      yahooSymbol,
      name: raw.shortName ?? raw.longName ?? normalizedTicker,
      exchange: formatExchangeLabel(raw.exchange, raw.fullExchangeName),
      price,
      currency,
    };
  } catch (err) {
    if (isYahooNotFoundError(err)) {
      return {
        status: "INVALID",
        normalizedTicker,
        yahooSymbol,
        reason: `Ticker "${normalizedTicker}" não encontrado em ${getExpectedExchangeLabel(assetClass)}.`,
      };
    }

    return {
      status: "UNAVAILABLE",
      normalizedTicker,
      yahooSymbol,
      reason:
        "Não foi possível consultar o Yahoo Finance no momento para validar este ticker.",
    };
  }
}

export async function searchTickersForClass(
  rawQuery: string,
  assetClass: AssetClassKey
): Promise<TickerSearchResponse> {
  if (isFixedIncomeClass(assetClass)) {
    return { results: [], unavailable: false };
  }

  const query = rawQuery.trim();
  if (!query) {
    return { results: [], unavailable: false };
  }

  const isBr = assetClass === "BR_STOCK" || assetClass === "BR_FII";
  const normalizedQuery = normalizeTicker(query, assetClass);
  const byTicker = new Map<string, TickerSearchResult>();

  const searchQueries = isBr && !query.toUpperCase().endsWith(".SA")
    ? [query, `${normalizedQuery}.SA`]
    : [query];

  let anySearchSucceeded = false;

  await Promise.allSettled(
    searchQueries.map(async (q) => {
      const res = await withTimeout(
        yahooFinance.search(q, { quotesCount: 12, newsCount: 0 }),
        YAHOO_TIMEOUT_MS
      );
      anySearchSucceeded = true;

      const quotes = Array.isArray(res?.quotes)
        ? (res.quotes as RawYahooSearchQuote[])
        : [];

      for (const item of quotes) {
        if (!item || typeof item !== "object" || !item.symbol) continue;
        const ok = matchesExpectedExchange(assetClass, {
          symbol: item.symbol,
          exchange: item.exchange,
          exchDisp: item.exchDisp,
          quoteType: item.quoteType,
        });
        if (!ok) continue;

        const cleanTicker = normalizeTicker(item.symbol, assetClass);
        if (!cleanTicker || byTicker.has(cleanTicker)) continue;

        byTicker.set(cleanTicker, {
          ticker: cleanTicker,
          yahooSymbol: item.symbol.toUpperCase(),
          name: item.shortname ?? item.longname ?? cleanTicker,
          exchange: formatExchangeLabel(item.exchange, item.exchDisp),
          quoteType: item.quoteType ?? "EQUITY",
          currency: isBr ? "BRL" : "USD",
        });
      }
    })
  );

  // If the user typed a valid-looking exact ticker that didn't surface in search
  // (common for smaller B3 FIIs), try a direct quote lookup.
  if (
    isTickerFormatValid(normalizedQuery, assetClass) &&
    !byTicker.has(normalizedQuery)
  ) {
    const exactCheck = await validateTickerOnYahoo(normalizedQuery, assetClass);
    if (exactCheck.status === "VALID" && exactCheck.yahooSymbol) {
      anySearchSucceeded = true;
      byTicker.set(exactCheck.normalizedTicker, {
        ticker: exactCheck.normalizedTicker,
        yahooSymbol: exactCheck.yahooSymbol,
        name: exactCheck.name ?? exactCheck.normalizedTicker,
        exchange: exactCheck.exchange ?? (isBr ? "B3" : "EUA"),
        quoteType: "EQUITY",
        currency: exactCheck.currency ?? (isBr ? "BRL" : "USD"),
        price: exactCheck.price ?? null,
      });
    } else if (exactCheck.status === "INVALID") {
      anySearchSucceeded = true;
    }
  }

  // Sort exact match first, then prefix matches, then others
  const results = Array.from(byTicker.values())
    .sort((a, b) => {
      const aExact = a.ticker === normalizedQuery ? 0 : 1;
      const bExact = b.ticker === normalizedQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const aPrefix = a.ticker.startsWith(normalizedQuery) ? 0 : 1;
      const bPrefix = b.ticker.startsWith(normalizedQuery) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return a.ticker.localeCompare(b.ticker);
    })
    .slice(0, 8);

  return {
    results,
    unavailable: !anySearchSucceeded && results.length === 0,
  };
}
