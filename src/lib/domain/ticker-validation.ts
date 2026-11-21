import {
  type AssetClassKey,
  type TickerValidationStatusKey,
  isFixedIncomeClass,
} from "./types";

export interface YahooQuoteMetadata {
  symbol?: string | null;
  exchange?: string | null;
  exchDisp?: string | null;
  quoteType?: string | null;
  currency?: string | null;
  shortName?: string | null;
  longName?: string | null;
}

export type ValidationOutcome = "VALID" | "INVALID" | "UNAVAILABLE";

const BR_EXCHANGES = new Set(["SAO", "BSP", "BVMF", "B3"]);

const US_EXCHANGES = new Set([
  "NMS",
  "NGM",
  "NCM",
  "NAS",
  "NYQ",
  "NYS",
  "NYE",
  "ASE",
  "PCX",
  "ARC",
  "BTS",
  "BATS",
  "CBO",
  "IEX",
]);

const ALLOWED_QUOTE_TYPES = new Set(["EQUITY", "ETF", "TRUST"]);

const DISALLOWED_QUOTE_TYPES = new Set([
  "CRYPTOCURRENCY",
  "CURRENCY",
  "INDEX",
  "FUTURE",
  "OPTION",
  "ECNQUOTE",
  "MONEYMARKET",
]);

const BR_TICKER_REGEX = /^[A-Z0-9]{4,8}$/;
const US_TICKER_REGEX = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;

/**
 * Normalizes a ticker for storage according to its asset class.
 * - For BR variable income, strips trailing `.SA` suffix so tickers are stored as `WEGE3`, `HGLG11`, etc.
 * - For all other classes, trims and uppercases.
 */
export function normalizeTicker(
  rawTicker: string,
  assetClass: AssetClassKey
): string {
  const clean = rawTicker.trim().toUpperCase();
  if (
    (assetClass === "BR_STOCK" || assetClass === "BR_FII") &&
    clean.endsWith(".SA")
  ) {
    return clean.slice(0, -3);
  }
  return clean;
}

/**
 * Basic syntax check for variable-income tickers before querying Yahoo Finance.
 * Always returns true for fixed income and emergency reserve classes.
 */
export function isTickerFormatValid(
  ticker: string,
  assetClass: AssetClassKey
): boolean {
  if (isFixedIncomeClass(assetClass)) return true;
  const normalized = normalizeTicker(ticker, assetClass);
  if (!normalized || /\s/.test(normalized)) return false;

  if (assetClass === "BR_STOCK" || assetClass === "BR_FII") {
    return BR_TICKER_REGEX.test(normalized);
  }

  return US_TICKER_REGEX.test(normalized);
}

/**
 * Checks whether Yahoo Finance quote/search metadata belongs to the expected
 * stock exchange and asset category for the given variable-income class.
 */
export function matchesExpectedExchange(
  assetClass: AssetClassKey,
  meta: YahooQuoteMetadata
): boolean {
  if (isFixedIncomeClass(assetClass)) return true;

  const symbol = (meta.symbol ?? "").trim().toUpperCase();
  const exchange = (meta.exchange ?? "").trim().toUpperCase();
  const currency = (meta.currency ?? "").trim().toUpperCase();
  const quoteType = (meta.quoteType ?? "").trim().toUpperCase();

  if (!symbol) return false;

  if (quoteType) {
    if (DISALLOWED_QUOTE_TYPES.has(quoteType)) return false;
    if (!ALLOWED_QUOTE_TYPES.has(quoteType)) return false;
  }

  if (assetClass === "BR_STOCK" || assetClass === "BR_FII") {
    const isB3Symbol = symbol.endsWith(".SA");
    const isB3Exchange = exchange ? BR_EXCHANGES.has(exchange) : false;
    if (!isB3Symbol && !isB3Exchange) return false;
    if (currency && currency !== "BRL") return false;
    return true;
  }

  // US_STOCK or US_REIT
  if (symbol.includes(".")) {
    // Reject foreign exchange suffixes such as `.SA`, `.L`, `.TO`, `.DE`, etc.
    // Allow only single-letter share classes like `BRK.B` if exchange is US.
    const suffix = symbol.split(".").pop() ?? "";
    if (suffix.length > 1) return false;
  }

  if (exchange && !US_EXCHANGES.has(exchange)) {
    return false;
  }

  if (!exchange) {
    // Without exchange metadata, require USD currency to avoid false matches
    if (currency !== "USD") return false;
  } else if (currency && currency !== "USD") {
    return false;
  }

  return true;
}

/**
 * Human-readable exchange label for UI display.
 */
export function formatExchangeLabel(
  exchange: string | null | undefined,
  exchDisp?: string | null
): string {
  const code = (exchange ?? "").trim().toUpperCase();
  if (BR_EXCHANGES.has(code)) return "B3";
  if (code === "NMS" || code === "NGM" || code === "NCM" || code === "NAS") {
    return "NASDAQ";
  }
  if (code === "NYQ" || code === "NYS" || code === "NYE") return "NYSE";
  if (code === "PCX" || code === "ARC") return "NYSE Arca";
  if (code === "ASE") return "NYSE American";
  if (code === "BTS" || code === "BATS") return "Cboe BZX";
  if (exchDisp && exchDisp.trim()) return exchDisp.trim();
  return code || "—";
}

/**
 * Computes the next persisted validation status for an asset given a Yahoo check outcome.
 * Temporary outages (`UNAVAILABLE`) never downgrade an already verified asset or falsely
 * mark a pending asset as invalid.
 */
export function resolveValidationStatusTransition(
  currentStatus: TickerValidationStatusKey,
  outcome: ValidationOutcome
): TickerValidationStatusKey {
  if (outcome === "VALID") return "VERIFIED";
  if (outcome === "INVALID") return "INVALID";
  return currentStatus;
}

export function getExpectedExchangeLabel(assetClass: AssetClassKey): string {
  if (assetClass === "BR_STOCK" || assetClass === "BR_FII") {
    return "B3 (Brasil)";
  }
  if (assetClass === "US_STOCK" || assetClass === "US_REIT") {
    return "bolsas dos EUA (NYSE/NASDAQ)";
  }
  return "Renda Fixa";
}
