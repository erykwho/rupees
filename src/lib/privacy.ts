import {
  type AssetClassKey,
  type CurrencyCode,
  formatBRL,
  formatCurrency,
  formatQty,
  formatUSD,
} from "./domain/types";

export const PRIVACY_STORAGE_KEY = "rupees-privacy";

export const MASKED_BRL = "R$ •••••";
export const MASKED_USD = "US$ •••••";
export const MASKED_COMPACT = "••••";
export const MASKED_QTY = "••••";

export function maskBRL(value: number, isPrivate: boolean): string {
  return isPrivate ? MASKED_BRL : formatBRL(value);
}

export function maskSignedBRL(value: number, isPrivate: boolean): string {
  if (isPrivate) return MASKED_BRL;
  return `${value >= 0 ? "+" : ""}${formatBRL(value)}`;
}

export function maskUSD(value: number, isPrivate: boolean): string {
  return isPrivate ? MASKED_USD : formatUSD(value);
}

export function maskCurrency(
  value: number,
  currency: CurrencyCode,
  isPrivate: boolean
): string {
  if (isPrivate) {
    return currency === "USD" ? MASKED_USD : MASKED_BRL;
  }
  return formatCurrency(value, currency);
}

export function maskQty(
  value: number,
  isPrivate: boolean,
  assetClass?: AssetClassKey
): string {
  return isPrivate ? MASKED_QTY : formatQty(value, assetClass);
}
