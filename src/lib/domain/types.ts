export type AssetClassKey =
  | "FIXED_INCOME"
  | "BR_STOCK"
  | "BR_FII"
  | "US_STOCK"
  | "US_REIT"
  | "EMERGENCY_RESERVE";

export type InvestmentClassKey = Exclude<AssetClassKey, "EMERGENCY_RESERVE">;

export type CurrencyCode = "BRL" | "USD";
export type PriceModeKey = "AUTO_YAHOO" | "MANUAL";
export type TransactionTypeKey = "BUY" | "SELL" | "BALANCE_ADJUSTMENT";

export const INVESTMENT_CLASSES: InvestmentClassKey[] = [
  "FIXED_INCOME",
  "BR_STOCK",
  "BR_FII",
  "US_STOCK",
  "US_REIT",
];

export const ALL_ASSET_CLASSES: AssetClassKey[] = [
  ...INVESTMENT_CLASSES,
  "EMERGENCY_RESERVE",
];

export const ASSET_CLASS_LABELS: Record<AssetClassKey, string> = {
  FIXED_INCOME: "Renda Fixa",
  BR_STOCK: "Ação",
  BR_FII: "FII",
  US_STOCK: "Stock",
  US_REIT: "REIT",
  EMERGENCY_RESERVE: "Reserva",
};

export const ASSET_CLASS_COLORS: Record<AssetClassKey, string> = {
  FIXED_INCOME: "#ec4899", // Rosa / Magenta
  BR_STOCK: "#10b981", // Verde Esmeralda
  BR_FII: "#8b5cf6", // Roxo / Violeta
  US_STOCK: "#0ea5e9", // Azul Celeste
  US_REIT: "#f59e0b", // Âmbar / Laranja
  EMERGENCY_RESERVE: "#64748b", // Cinza Slate
};

export interface GoalInput {
  fixedIncomePct: number;
  variableIncomePct: number;
  brazilPct: number;
  usaPct: number;
  brStocksPct: number;
  brFiisPct: number;
  usStocksPct: number;
  usReitsPct: number;
}

export interface AssetInput {
  id: string;
  ticker: string;
  assetClass: AssetClassKey;
  sector: string;
  currency: CurrencyCode;
  targetPctInClass: number;
  priceMode: PriceModeKey;
  manualPrice: number | null;
  isActive: boolean;
}

export interface TransactionInput {
  id: string;
  assetId: string;
  date: Date | string;
  type: TransactionTypeKey;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  notes?: string | null;
}

export interface AssetPosition {
  quantity: number;
  avgPrice: number;
  investedCost: number;
}

export interface AssetSummary {
  id: string;
  ticker: string;
  assetClass: AssetClassKey;
  sector: string;
  currency: CurrencyCode;
  priceMode: PriceModeKey;
  manualPrice: number | null;
  isActive: boolean;
  targetPctInClass: number;
  globalTargetPct: number;
  quantity: number;
  avgPriceNative: number;
  investedCostNative: number;
  investedCostBRL: number;
  currentPriceNative: number;
  currentPriceBRL: number;
  currentValueBRL: number;
  profitLossBRL: number;
  profitLossPct: number;
  actualPct: number;
  diffPct: number;
  balanceNeededBRL: number;
  quoteUpdatedAt: string | null;
}

export interface ClassSummary {
  assetClass: InvestmentClassKey;
  label: string;
  targetPct: number;
  actualPct: number;
  currentValueBRL: number;
  investedCostBRL: number;
  diffPct: number;
  balanceNeededBRL: number;
  targetSumInClass: number;
}

export interface HierarchyRow {
  key: string;
  label: string;
  group: "MACRO" | "REGION" | "BR" | "US";
  targetPct: number;
  actualPct: number;
  diffPct: number;
}

export interface SectorSummary {
  assetClass: AssetClassKey;
  sector: string;
  currentValueBRL: number;
  targetPctInClass: number;
  actualPctInClass: number;
}

export interface PortfolioSummary {
  usdBrl: number;
  usdBrlUpdatedAt: string | null;
  totalInvestedValueBRL: number;
  totalCostBasisBRL: number;
  totalProfitLossBRL: number;
  totalProfitLossPct: number;
  emergencyReserveBRL: number;
  grandTotalBRL: number;
  classes: ClassSummary[];
  hierarchy: HierarchyRow[];
  assets: AssetSummary[];
  sectors: SectorSummary[];
}

export interface ContributionSuggestion {
  assetId: string;
  ticker: string;
  assetClass: InvestmentClassKey;
  currency: CurrencyCode;
  neededBRL: number;
  unitPriceBRL: number;
  unitPriceNative: number;
  investBRL: number;
  investUSD: number;
  suggestedQty: number;
  isFractional: boolean;
}

export interface ContributionPlanResult {
  amountBRL: number;
  totalAllocatedBRL: number;
  remainingBRL: number;
  usdBrl: number;
  suggestions: ContributionSuggestion[];
}

export function getYahooSymbol(ticker: string, assetClass: AssetClassKey): string | null {
  if (assetClass === "FIXED_INCOME" || assetClass === "EMERGENCY_RESERVE") {
    return null;
  }
  const clean = ticker.trim().toUpperCase();
  if (assetClass === "BR_STOCK" || assetClass === "BR_FII") {
    return clean.endsWith(".SA") ? clean : `${clean}.SA`;
  }
  return clean;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatUSD(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatCurrency(value: number, currency: CurrencyCode): string {
  return currency === "USD" ? formatUSD(value) : formatBRL(value);
}

export function formatPct(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${safe.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

export function formatQty(value: number, assetClass?: AssetClassKey): string {
  const safe = Number.isFinite(value) ? value : 0;
  const isFractional =
    assetClass === "US_STOCK" ||
    assetClass === "US_REIT" ||
    !Number.isInteger(safe);
  return safe.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: isFractional ? 5 : 0,
  });
}
