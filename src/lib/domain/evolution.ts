import {
  ALL_ASSET_CLASSES,
  type AssetClassKey,
  type AssetInput,
  INVESTMENT_CLASSES,
  type TransactionInput,
  getYahooSymbol,
  isFixedIncomeClass,
} from "./types";
import type { QuoteMapEntry } from "./calculations";
import {
  type HistoricalBenchmarkRates,
  computeAnnualGrossRatePct,
  getRegressiveIrRate,
} from "./fixed-income";

const EPSILON = 1e-8;
const DAYS_PER_YEAR = 365;
const USD_BRL_SYMBOL = "USDBRL=X";

export type EvolutionRange =
  | "1M"
  | "3M"
  | "6M"
  | "YTD"
  | "1A"
  | "2A"
  | "5A"
  | "ALL";

export type EvolutionGranularity = "DAILY" | "MONTHLY";
export type EvolutionChartMode = "PATRIMONIO" | "GANHO" | "RENTABILIDADE";

export interface ClassDayMetrics {
  marketValueBRL: number;
  investedCostBRL: number;
  netContributionBRL: number;
}

export interface EvolutionDayPoint {
  date: string; // "YYYY-MM-DD"
  usdBrl: number;
  byClass: Record<AssetClassKey, ClassDayMetrics>;
}

export interface EvolutionData {
  points: EvolutionDayPoint[];
  firstTransactionDate: string | null;
  lastDate: string | null;
  usdBrl: number;
  usdBrlUpdatedAt: string | null;
  hasEstimatedFixedIncome?: boolean;
}

export interface AggregatedEvolutionPoint {
  date: string; // "YYYY-MM-DD" (or last date of month in MONTHLY mode)
  label: string; // Formatted for X axis ("14/03" or "Mar/25")
  tooltipLabel: string; // Full label ("14/03/2025" or "Mar/2025")
  marketValueBRL: number;
  investedCostBRL: number;
  profitLossBRL: number;
  profitLossPct: number;
  usdBrl: number;
  classMarketValue: Record<AssetClassKey, number>;
  classProfitLoss: Record<AssetClassKey, number>;
  classProfitLossPct: Record<AssetClassKey, number>;
}

export interface AggregatedContributionPoint {
  key: string; // "YYYY-MM" or "YYYY-MM-DD"
  label: string;
  tooltipLabel: string;
  totalBRL: number;
  FIXED_INCOME: number;
  BR_STOCK: number;
  BR_FII: number;
  US_STOCK: number;
  US_REIT: number;
  EMERGENCY_RESERVE: number;
}

export interface EvolutionKpis {
  currentMarketValueBRL: number;
  totalInvestedCostBRL: number;
  totalProfitLossBRL: number;
  totalProfitLossPct: number;
  periodContributionBRL: number;
  periodGainBRL: number;
  periodReturnPct: number;
  isSubPeriod: boolean;
}

export interface AggregatedEvolutionResult {
  activeClasses: AssetClassKey[];
  evolutionSeries: AggregatedEvolutionPoint[];
  contributionSeries: AggregatedContributionPoint[];
  kpis: EvolutionKpis;
}

const MONTH_NAMES_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
];

export function toISODate(value: Date | string): string {
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
    return new Date(value).toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

export function addDaysISO(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonthsISO(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const targetMonthIndex = m - 1 + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(d, lastDayOfTargetMonth);
  const dt = new Date(Date.UTC(targetYear, normalizedMonth, clampedDay));
  return dt.toISOString().slice(0, 10);
}

function isWeekdayISO(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day !== 0 && day !== 6;
}

function isLastDayOfMonthISO(isoDate: string): boolean {
  const next = addDaysISO(isoDate, 1);
  return next.slice(0, 7) !== isoDate.slice(0, 7);
}

export function formatDateAxisPTBR(isoDate: string, includeYear = false): string {
  const [y, m, d] = isoDate.split("-");
  return includeYear ? `${d}/${m}/${y.slice(2)}` : `${d}/${m}`;
}

export function formatDateFullPTBR(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y}`;
}

export function formatMonthAxisPTBR(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const monthIdx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${MONTH_NAMES_SHORT[monthIdx]}/${y.slice(2)}`;
}

export function formatMonthFullPTBR(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  const monthIdx = Math.max(0, Math.min(11, Number(m) - 1));
  return `${MONTH_NAMES_SHORT[monthIdx]}/${y}`;
}

function createEmptyByClass(): Record<AssetClassKey, ClassDayMetrics> {
  return {
    FIXED_INCOME: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
    BR_STOCK: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
    BR_FII: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
    US_STOCK: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
    US_REIT: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
    EMERGENCY_RESERVE: { marketValueBRL: 0, investedCostBRL: 0, netContributionBRL: 0 },
  };
}

function findLatestPriceOnOrBefore(
  series: Record<string, number> | undefined,
  targetDate: string,
  allowZero = false
): number | null {
  if (!series) return null;
  let bestDate = "";
  let bestPrice: number | null = null;
  for (const [date, price] of Object.entries(series)) {
    const valid = allowZero
      ? Number.isFinite(price) && price >= 0
      : Number.isFinite(price) && price > 0;
    if (date <= targetDate && valid && date > bestDate) {
      bestDate = date;
      bestPrice = price;
    }
  }
  return bestPrice;
}

function diffDaysISO(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split("-").map(Number);
  const [y2, m2, d2] = toISO.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.round((t2 - t1) / (24 * 60 * 60 * 1000));
}

function daysInMonthISO(isoDate: string): number {
  const [y, m] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function computeDailyFactorFromAnnualPct(annualPct: number): number {
  const base = 1 + annualPct / 100;
  if (!Number.isFinite(base) || base <= 0) return 0;
  return Math.pow(base, 1 / DAYS_PER_YEAR);
}

interface FixedIncomeLot {
  buyDate: string;
  realQty: number;
  baseValueBRL: number;
  accruedGrossGainBRL: number;
  contractedRate: number | null;
}

function computeLotNetValueBRL(
  lot: FixedIncomeLot,
  date: string,
  maturityDateISO: string | null,
  taxExempt: boolean
): number {
  const effectiveDate =
    maturityDateISO && date > maturityDateISO ? maturityDateISO : date;
  const holdingDays = Math.max(0, diffDaysISO(lot.buyDate, effectiveDate));
  const irRate = getRegressiveIrRate(holdingDays, taxExempt);
  const netGain =
    lot.accruedGrossGainBRL > 0
      ? lot.accruedGrossGainBRL * (1 - irRate)
      : lot.accruedGrossGainBRL;
  return Math.max(0, lot.baseValueBRL + netGain);
}

export function computePortfolioEvolution(params: {
  assets: AssetInput[];
  transactions: TransactionInput[];
  historicalPrices: Record<string, Record<string, number>>;
  currentQuotes: Record<string, QuoteMapEntry>;
  currentUsdBrl: number;
  currentUsdBrlUpdatedAt?: string | null;
  todayISO?: string;
  fixedIncomeRates?: HistoricalBenchmarkRates;
}): EvolutionData {
  const {
    assets,
    transactions,
    historicalPrices,
    currentQuotes,
    currentUsdBrl,
    currentUsdBrlUpdatedAt = null,
    todayISO = toISODate(new Date()),
    fixedIncomeRates,
  } = params;

  if (transactions.length === 0 || assets.length === 0) {
    return {
      points: [],
      firstTransactionDate: null,
      lastDate: null,
      usdBrl: currentUsdBrl,
      usdBrlUpdatedAt: currentUsdBrlUpdatedAt,
      hasEstimatedFixedIncome: false,
    };
  }

  const assetById = new Map(assets.map((a) => [a.id, a]));
  const assetSymbols = new Map<string, string | null>();
  for (const asset of assets) {
    assetSymbols.set(
      asset.id,
      asset.priceMode === "AUTO_YAHOO"
        ? getYahooSymbol(asset.ticker, asset.assetClass)
        : null
    );
  }

  // Sort transactions chronologically
  const sortedTx = [...transactions]
    .filter((tx) => assetById.has(tx.assetId))
    .sort((a, b) => {
      const da = toISODate(a.date);
      const db = toISODate(b.date);
      if (da !== db) return da.localeCompare(db);
      return a.id.localeCompare(b.id);
    });

  if (sortedTx.length === 0) {
    return {
      points: [],
      firstTransactionDate: null,
      lastDate: null,
      usdBrl: currentUsdBrl,
      usdBrlUpdatedAt: currentUsdBrlUpdatedAt,
      hasEstimatedFixedIncome: false,
    };
  }

  const firstDate = toISODate(sortedTx[0].date);
  const lastTxDate = toISODate(sortedTx[sortedTx.length - 1].date);
  const endDate = lastTxDate > todayISO ? lastTxDate : todayISO;

  // Group transactions by ISO date
  const txByDate = new Map<string, TransactionInput[]>();
  const assetsWithLotRate = new Set<string>();
  for (const tx of sortedTx) {
    const d = toISODate(tx.date);
    const list = txByDate.get(d);
    if (list) list.push(tx);
    else txByDate.set(d, [tx]);

    if (
      tx.type === "BUY" &&
      tx.fixedIncomeRate !== undefined &&
      tx.fixedIncomeRate !== null &&
      Number.isFinite(tx.fixedIncomeRate)
    ) {
      assetsWithLotRate.add(tx.assetId);
    }
  }

  // Determine which assets use daily fixed-income net-of-IR estimation
  const estimatedFiAssetIds = new Set<string>();
  const assetMaturityISO = new Map<string, string | null>();
  if (fixedIncomeRates) {
    for (const asset of assets) {
      if (!isFixedIncomeClass(asset.assetClass)) continue;
      if (!asset.fixedIncomeIndex) continue;
      const hasDefaultRate =
        asset.fixedIncomeRate !== undefined &&
        asset.fixedIncomeRate !== null &&
        Number.isFinite(asset.fixedIncomeRate);
      if (!hasDefaultRate && !assetsWithLotRate.has(asset.id)) continue;

      estimatedFiAssetIds.add(asset.id);
      assetMaturityISO.set(
        asset.id,
        asset.maturityDate ? toISODate(asset.maturityDate) : null
      );
    }
  }

  // Seed carry-forward prices from dates strictly before firstDate
  const lastKnownPrice = new Map<string, number>();
  for (const sym of assetSymbols.values()) {
    if (!sym) continue;
    const seeded = findLatestPriceOnOrBefore(historicalPrices[sym], firstDate);
    if (seeded !== null && seeded > 0) {
      lastKnownPrice.set(sym, seeded);
    }
  }

  const usdSeries = historicalPrices[USD_BRL_SYMBOL];
  let lastKnownUsdBrl =
    findLatestPriceOnOrBefore(usdSeries, firstDate) ?? currentUsdBrl;

  // Seed carry-forward historical BCB rates
  let lastKnownSelic = fixedIncomeRates
    ? (findLatestPriceOnOrBefore(
        fixedIncomeRates.selicAnnualPct,
        firstDate,
        true
      ) ?? fixedIncomeRates.fallback.selic)
    : 0;
  let lastKnownCdi = fixedIncomeRates
    ? (findLatestPriceOnOrBefore(
        fixedIncomeRates.cdiAnnualPct,
        firstDate,
        true
      ) ?? fixedIncomeRates.fallback.cdi)
    : 0;

  // Running state per asset
  const stateByAsset = new Map<string, { quantity: number; avgPrice: number }>();
  const fiLotsByAsset = new Map<string, FixedIncomeLot[]>();
  for (const asset of assets) {
    stateByAsset.set(asset.id, { quantity: 0, avgPrice: 0 });
    if (estimatedFiAssetIds.has(asset.id)) {
      fiLotsByAsset.set(asset.id, []);
    }
  }

  const points: EvolutionDayPoint[] = [];
  let hasEstimatedFixedIncome = false;

  for (let date = firstDate; date <= endDate; date = addDaysISO(date, 1)) {
    // 0. Update BCB benchmark rates and accrue 1 calendar day on existing fixed-income lots
    if (fixedIncomeRates && estimatedFiAssetIds.size > 0) {
      const selicOnDay = fixedIncomeRates.selicAnnualPct[date];
      if (typeof selicOnDay === "number" && Number.isFinite(selicOnDay) && selicOnDay >= 0) {
        lastKnownSelic = selicOnDay;
      }
      const cdiOnDay = fixedIncomeRates.cdiAnnualPct[date];
      if (typeof cdiOnDay === "number" && Number.isFinite(cdiOnDay) && cdiOnDay >= 0) {
        lastKnownCdi = cdiOnDay;
      }

      const ym = date.slice(0, 7);
      const monthlyIpca = fixedIncomeRates.ipcaMonthlyPct[ym];
      const dayIpcaAnnual =
        typeof monthlyIpca === "number" && Number.isFinite(monthlyIpca)
          ? (Math.pow(
              1 + Math.max(0, monthlyIpca) / 100,
              DAYS_PER_YEAR / daysInMonthISO(date)
            ) -
              1) *
            100
          : fixedIncomeRates.fallback.ipca;

      const dayBenchmarks = {
        selic: lastKnownSelic,
        cdi: lastKnownCdi,
        ipca: dayIpcaAnnual,
      };

      for (const assetId of estimatedFiAssetIds) {
        const lots = fiLotsByAsset.get(assetId);
        if (!lots || lots.length === 0) continue;

        const maturityISO = assetMaturityISO.get(assetId) ?? null;
        if (maturityISO && date > maturityISO) continue;

        const asset = assetById.get(assetId)!;
        const index = asset.fixedIncomeIndex!;

        for (const lot of lots) {
          if (lot.contractedRate === null || !Number.isFinite(lot.contractedRate)) {
            continue;
          }
          const annualGrossRatePct = computeAnnualGrossRatePct(
            index,
            lot.contractedRate,
            dayBenchmarks
          );
          const dailyFactor = computeDailyFactorFromAnnualPct(annualGrossRatePct);
          const currentGross = lot.baseValueBRL + lot.accruedGrossGainBRL;
          if (currentGross > EPSILON && dailyFactor > 0) {
            lot.accruedGrossGainBRL += currentGross * (dailyFactor - 1);
          }
        }
      }
    }

    // 1. Update FX rate for this date
    if (date === todayISO && currentUsdBrl > 0) {
      lastKnownUsdBrl = currentUsdBrl;
    } else if (usdSeries && usdSeries[date] > 0) {
      lastKnownUsdBrl = usdSeries[date];
    }
    const usdBrl = lastKnownUsdBrl > 0 ? lastKnownUsdBrl : currentUsdBrl;

    // 2. Update carry-forward market prices for this date
    for (const sym of assetSymbols.values()) {
      if (!sym) continue;
      if (date === todayISO) {
        const live = currentQuotes[sym]?.price;
        if (live && live > 0) {
          lastKnownPrice.set(sym, live);
          continue;
        }
      }
      const hist = historicalPrices[sym]?.[date];
      if (hist && hist > 0) {
        lastKnownPrice.set(sym, hist);
      }
    }

    // 3. Apply transactions on this date
    const dayTx = txByDate.get(date) ?? [];
    const dayContribByClass: Record<AssetClassKey, number> = {
      FIXED_INCOME: 0,
      BR_STOCK: 0,
      BR_FII: 0,
      US_STOCK: 0,
      US_REIT: 0,
      EMERGENCY_RESERVE: 0,
    };

    for (const tx of dayTx) {
      const asset = assetById.get(tx.assetId);
      const st = stateByAsset.get(tx.assetId);
      if (!asset || !st) continue;

      const qty = Math.abs(tx.quantity);
      const total = Math.abs(tx.totalAmount);
      const fxRate = asset.currency === "USD" ? usdBrl : 1;
      const fiLots = fiLotsByAsset.get(asset.id);

      if (tx.type === "BUY") {
        const nextQty = st.quantity + qty;
        if (nextQty > EPSILON) {
          st.avgPrice = (st.quantity * st.avgPrice + total) / nextQty;
        }
        st.quantity = nextQty;
        dayContribByClass[asset.assetClass] += total * fxRate;

        if (fiLots) {
          const manualPrice = asset.manualPrice ?? 1;
          const initialVal = total > EPSILON ? total : qty * manualPrice;
          const lotRate =
            tx.fixedIncomeRate !== undefined &&
            tx.fixedIncomeRate !== null &&
            Number.isFinite(tx.fixedIncomeRate)
              ? tx.fixedIncomeRate
              : asset.fixedIncomeRate !== undefined &&
                  asset.fixedIncomeRate !== null &&
                  Number.isFinite(asset.fixedIncomeRate)
                ? asset.fixedIncomeRate
                : null;
          fiLots.push({
            buyDate: date,
            realQty: qty,
            baseValueBRL: initialVal,
            accruedGrossGainBRL: 0,
            contractedRate: lotRate,
          });
        }
      } else if (tx.type === "SELL") {
        st.quantity = Math.max(0, st.quantity - qty);
        if (st.quantity <= EPSILON) {
          st.quantity = 0;
          st.avgPrice = 0;
        }
        dayContribByClass[asset.assetClass] -= total * fxRate;

        if (fiLots) {
          if (st.quantity <= EPSILON) {
            fiLots.length = 0;
          } else {
            let remainingToSell = qty;
            while (remainingToSell > EPSILON && fiLots.length > 0) {
              const lot = fiLots[0];
              if (lot.realQty <= remainingToSell + EPSILON) {
                remainingToSell -= lot.realQty;
                fiLots.shift();
              } else {
                const keepRatio = (lot.realQty - remainingToSell) / lot.realQty;
                lot.realQty -= remainingToSell;
                lot.baseValueBRL *= keepRatio;
                lot.accruedGrossGainBRL *= keepRatio;
                remainingToSell = 0;
              }
            }
          }
        }
      } else if (tx.type === "BALANCE_ADJUSTMENT") {
        // Yield/balance update for Fixed Income / Reserve: does NOT count as contribution
        // and preserves cost basis so yield appears in profit/loss.
        const prevCost = st.quantity * st.avgPrice;
        const nextQty = Math.max(0, st.quantity + tx.quantity);
        if (nextQty <= EPSILON) {
          st.quantity = 0;
          st.avgPrice = 0;
        } else {
          if (st.quantity <= EPSILON) {
            st.avgPrice = 1;
          } else {
            st.avgPrice = prevCost / nextQty;
          }
          st.quantity = nextQty;
        }

        // Anchor estimated lots to the real balance reported by BALANCE_ADJUSTMENT
        if (fiLots) {
          const manualPrice = asset.manualPrice ?? 1;
          const anchoredBalanceBRL = st.quantity * manualPrice;
          if (st.quantity <= EPSILON || anchoredBalanceBRL <= EPSILON) {
            fiLots.length = 0;
          } else if (fiLots.length === 0) {
            fiLots.push({
              buyDate: date,
              realQty: st.quantity,
              baseValueBRL: anchoredBalanceBRL,
              accruedGrossGainBRL: 0,
              contractedRate:
                asset.fixedIncomeRate !== undefined &&
                asset.fixedIncomeRate !== null &&
                Number.isFinite(asset.fixedIncomeRate)
                  ? asset.fixedIncomeRate
                  : null,
            });
          } else {
            const maturityISO = assetMaturityISO.get(asset.id) ?? null;
            const taxExempt = Boolean(asset.taxExempt);
            const lotNetValues = fiLots.map((lot) =>
              computeLotNetValueBRL(lot, date, maturityISO, taxExempt)
            );
            const totalNet = lotNetValues.reduce((s, v) => s + v, 0);
            const totalRealQty = fiLots.reduce((s, lot) => s + lot.realQty, 0);

            for (let i = 0; i < fiLots.length; i++) {
              const lot = fiLots[i];
              const weight =
                totalNet > EPSILON
                  ? lotNetValues[i] / totalNet
                  : totalRealQty > EPSILON
                    ? lot.realQty / totalRealQty
                    : 1 / fiLots.length;
              lot.baseValueBRL = anchoredBalanceBRL * weight;
              lot.realQty = st.quantity * weight;
              lot.accruedGrossGainBRL = 0;
            }
          }
        }
      }
    }

    // 4. Emit point on weekdays, transaction days, month-ends, firstDate, and endDate
    const shouldEmit =
      isWeekdayISO(date) ||
      dayTx.length > 0 ||
      date === firstDate ||
      date === endDate ||
      isLastDayOfMonthISO(date);

    if (!shouldEmit) continue;

    const byClass = createEmptyByClass();

    for (const cls of ALL_ASSET_CLASSES) {
      byClass[cls].netContributionBRL = round2(dayContribByClass[cls]);
    }

    for (const asset of assets) {
      const st = stateByAsset.get(asset.id);
      if (!st || st.quantity <= EPSILON) continue;

      const fxRate = asset.currency === "USD" ? usdBrl : 1;
      const fiLots = fiLotsByAsset.get(asset.id);

      if (fiLots && fiLots.length > 0) {
        const maturityISO = assetMaturityISO.get(asset.id) ?? null;
        const taxExempt = Boolean(asset.taxExempt);
        let estimatedNetValueBRL = 0;
        for (const lot of fiLots) {
          estimatedNetValueBRL += computeLotNetValueBRL(
            lot,
            date,
            maturityISO,
            taxExempt
          );
        }
        byClass[asset.assetClass].marketValueBRL += estimatedNetValueBRL;
        byClass[asset.assetClass].investedCostBRL +=
          st.quantity * st.avgPrice * fxRate;
        hasEstimatedFixedIncome = true;
        continue;
      }

      const sym = assetSymbols.get(asset.id);
      let priceNative = 1;

      if (asset.priceMode === "MANUAL") {
        priceNative = asset.manualPrice ?? (st.avgPrice || 1);
      } else if (date === todayISO && sym && currentQuotes[sym]?.price > 0) {
        priceNative = currentQuotes[sym].price;
      } else if (sym && (lastKnownPrice.get(sym) ?? 0) > 0) {
        priceNative = lastKnownPrice.get(sym)!;
      } else if (asset.manualPrice && asset.manualPrice > 0) {
        priceNative = asset.manualPrice;
      } else if (st.avgPrice > 0) {
        priceNative = st.avgPrice;
      } else {
        priceNative = 0;
      }

      byClass[asset.assetClass].marketValueBRL += st.quantity * priceNative * fxRate;
      byClass[asset.assetClass].investedCostBRL += st.quantity * st.avgPrice * fxRate;
    }

    for (const cls of ALL_ASSET_CLASSES) {
      byClass[cls].marketValueBRL = round2(byClass[cls].marketValueBRL);
      byClass[cls].investedCostBRL = round2(byClass[cls].investedCostBRL);
    }

    points.push({
      date,
      usdBrl: round4(usdBrl),
      byClass,
    });
  }

  return {
    points,
    firstTransactionDate: firstDate,
    lastDate: endDate,
    usdBrl: currentUsdBrl,
    usdBrlUpdatedAt: currentUsdBrlUpdatedAt,
    hasEstimatedFixedIncome,
  };
}

/**
 * Calcula o valor de mercado atual estimado (líquido de IR, ancorado em BALANCE_ADJUSTMENT)
 * por ativo de Renda Fixa / Reserva de Emergência configurado, usando exatamente o mesmo motor
 * diário de `computePortfolioEvolution` para garantir consistência entre Visão Geral e Evolução.
 */
export function computeEstimatedFixedIncomeValuesAsOf(params: {
  assets: AssetInput[];
  transactions: TransactionInput[];
  fixedIncomeRates: HistoricalBenchmarkRates;
  asOfDateISO?: string;
}): Record<string, number> {
  const {
    assets,
    transactions,
    fixedIncomeRates,
    asOfDateISO = toISODate(new Date()),
  } = params;

  const fiAssets = assets.filter(
    (a) => isFixedIncomeClass(a.assetClass) && Boolean(a.fixedIncomeIndex)
  );
  if (fiAssets.length === 0 || transactions.length === 0) {
    return {};
  }

  const fiAssetById = new Map(fiAssets.map((a) => [a.id, a]));
  const sortedTx = [...transactions]
    .filter((tx) => fiAssetById.has(tx.assetId))
    .sort((a, b) => {
      const da = toISODate(a.date);
      const db = toISODate(b.date);
      if (da !== db) return da.localeCompare(db);
      return a.id.localeCompare(b.id);
    });

  if (sortedTx.length === 0) {
    return {};
  }

  const txByDate = new Map<string, TransactionInput[]>();
  const assetsWithLotRate = new Set<string>();
  for (const tx of sortedTx) {
    const d = toISODate(tx.date);
    const list = txByDate.get(d);
    if (list) list.push(tx);
    else txByDate.set(d, [tx]);

    if (
      tx.type === "BUY" &&
      tx.fixedIncomeRate !== undefined &&
      tx.fixedIncomeRate !== null &&
      Number.isFinite(tx.fixedIncomeRate)
    ) {
      assetsWithLotRate.add(tx.assetId);
    }
  }

  const estimatedFiAssetIds = new Set<string>();
  const assetMaturityISO = new Map<string, string | null>();
  for (const asset of fiAssets) {
    const hasDefaultRate =
      asset.fixedIncomeRate !== undefined &&
      asset.fixedIncomeRate !== null &&
      Number.isFinite(asset.fixedIncomeRate);
    if (!hasDefaultRate && !assetsWithLotRate.has(asset.id)) continue;

    estimatedFiAssetIds.add(asset.id);
    assetMaturityISO.set(
      asset.id,
      asset.maturityDate ? toISODate(asset.maturityDate) : null
    );
  }

  if (estimatedFiAssetIds.size === 0) {
    return {};
  }

  const firstDate = toISODate(sortedTx[0].date);
  const lastTxDate = toISODate(sortedTx[sortedTx.length - 1].date);
  const endDate = lastTxDate > asOfDateISO ? lastTxDate : asOfDateISO;

  let lastKnownSelic =
    findLatestPriceOnOrBefore(fixedIncomeRates.selicAnnualPct, firstDate, true) ??
    fixedIncomeRates.fallback.selic;
  let lastKnownCdi =
    findLatestPriceOnOrBefore(fixedIncomeRates.cdiAnnualPct, firstDate, true) ??
    fixedIncomeRates.fallback.cdi;

  const qtyByAsset = new Map<string, number>();
  const fiLotsByAsset = new Map<string, FixedIncomeLot[]>();
  for (const assetId of estimatedFiAssetIds) {
    qtyByAsset.set(assetId, 0);
    fiLotsByAsset.set(assetId, []);
  }

  for (let date = firstDate; date <= endDate; date = addDaysISO(date, 1)) {
    const selicOnDay = fixedIncomeRates.selicAnnualPct[date];
    if (
      typeof selicOnDay === "number" &&
      Number.isFinite(selicOnDay) &&
      selicOnDay >= 0
    ) {
      lastKnownSelic = selicOnDay;
    }
    const cdiOnDay = fixedIncomeRates.cdiAnnualPct[date];
    if (
      typeof cdiOnDay === "number" &&
      Number.isFinite(cdiOnDay) &&
      cdiOnDay >= 0
    ) {
      lastKnownCdi = cdiOnDay;
    }

    const ym = date.slice(0, 7);
    const monthlyIpca = fixedIncomeRates.ipcaMonthlyPct[ym];
    const dayIpcaAnnual =
      typeof monthlyIpca === "number" && Number.isFinite(monthlyIpca)
        ? (Math.pow(
            1 + Math.max(0, monthlyIpca) / 100,
            DAYS_PER_YEAR / daysInMonthISO(date)
          ) -
            1) *
          100
        : fixedIncomeRates.fallback.ipca;

    const dayBenchmarks = {
      selic: lastKnownSelic,
      cdi: lastKnownCdi,
      ipca: dayIpcaAnnual,
    };

    for (const assetId of estimatedFiAssetIds) {
      const lots = fiLotsByAsset.get(assetId);
      if (!lots || lots.length === 0) continue;

      const maturityISO = assetMaturityISO.get(assetId) ?? null;
      if (maturityISO && date > maturityISO) continue;

      const asset = fiAssetById.get(assetId)!;
      const index = asset.fixedIncomeIndex!;

      for (const lot of lots) {
        if (lot.contractedRate === null || !Number.isFinite(lot.contractedRate)) {
          continue;
        }
        const annualGrossRatePct = computeAnnualGrossRatePct(
          index,
          lot.contractedRate,
          dayBenchmarks
        );
        const dailyFactor = computeDailyFactorFromAnnualPct(annualGrossRatePct);
        const currentGross = lot.baseValueBRL + lot.accruedGrossGainBRL;
        if (currentGross > EPSILON && dailyFactor > 0) {
          lot.accruedGrossGainBRL += currentGross * (dailyFactor - 1);
        }
      }
    }

    const dayTx = txByDate.get(date) ?? [];
    for (const tx of dayTx) {
      if (!estimatedFiAssetIds.has(tx.assetId)) continue;
      const asset = fiAssetById.get(tx.assetId)!;
      const fiLots = fiLotsByAsset.get(tx.assetId)!;
      const prevQty = qtyByAsset.get(tx.assetId) ?? 0;

      const qty = Math.abs(tx.quantity);
      const total = Math.abs(tx.totalAmount);

      if (tx.type === "BUY") {
        const nextQty = prevQty + qty;
        qtyByAsset.set(tx.assetId, nextQty);
        const manualPrice = asset.manualPrice ?? 1;
        const initialVal = total > EPSILON ? total : qty * manualPrice;
        const lotRate =
          tx.fixedIncomeRate !== undefined &&
          tx.fixedIncomeRate !== null &&
          Number.isFinite(tx.fixedIncomeRate)
            ? tx.fixedIncomeRate
            : asset.fixedIncomeRate !== undefined &&
                asset.fixedIncomeRate !== null &&
                Number.isFinite(asset.fixedIncomeRate)
              ? asset.fixedIncomeRate
              : null;
        fiLots.push({
          buyDate: date,
          realQty: qty,
          baseValueBRL: initialVal,
          accruedGrossGainBRL: 0,
          contractedRate: lotRate,
        });
      } else if (tx.type === "SELL") {
        const nextQty = Math.max(0, prevQty - qty);
        qtyByAsset.set(tx.assetId, nextQty <= EPSILON ? 0 : nextQty);
        if (nextQty <= EPSILON) {
          fiLots.length = 0;
        } else {
          let remainingToSell = qty;
          while (remainingToSell > EPSILON && fiLots.length > 0) {
            const lot = fiLots[0];
            if (lot.realQty <= remainingToSell + EPSILON) {
              remainingToSell -= lot.realQty;
              fiLots.shift();
            } else {
              const keepRatio = (lot.realQty - remainingToSell) / lot.realQty;
              lot.realQty -= remainingToSell;
              lot.baseValueBRL *= keepRatio;
              lot.accruedGrossGainBRL *= keepRatio;
              remainingToSell = 0;
            }
          }
        }
      } else if (tx.type === "BALANCE_ADJUSTMENT") {
        const nextQty = Math.max(0, prevQty + tx.quantity);
        qtyByAsset.set(tx.assetId, nextQty <= EPSILON ? 0 : nextQty);
        const manualPrice = asset.manualPrice ?? 1;
        const anchoredBalanceBRL = nextQty * manualPrice;
        if (nextQty <= EPSILON || anchoredBalanceBRL <= EPSILON) {
          fiLots.length = 0;
        } else if (fiLots.length === 0) {
          fiLots.push({
            buyDate: date,
            realQty: nextQty,
            baseValueBRL: anchoredBalanceBRL,
            accruedGrossGainBRL: 0,
            contractedRate:
              asset.fixedIncomeRate !== undefined &&
              asset.fixedIncomeRate !== null &&
              Number.isFinite(asset.fixedIncomeRate)
                ? asset.fixedIncomeRate
                : null,
          });
        } else {
          const maturityISO = assetMaturityISO.get(tx.assetId) ?? null;
          const taxExempt = Boolean(asset.taxExempt);
          const lotNetValues = fiLots.map((lot) =>
            computeLotNetValueBRL(lot, date, maturityISO, taxExempt)
          );
          const totalNet = lotNetValues.reduce((s, v) => s + v, 0);
          const totalRealQty = fiLots.reduce((s, lot) => s + lot.realQty, 0);

          for (let i = 0; i < fiLots.length; i++) {
            const lot = fiLots[i];
            const weight =
              totalNet > EPSILON
                ? lotNetValues[i] / totalNet
                : totalRealQty > EPSILON
                  ? lot.realQty / totalRealQty
                  : 1 / fiLots.length;
            lot.baseValueBRL = anchoredBalanceBRL * weight;
            lot.realQty = nextQty * weight;
            lot.accruedGrossGainBRL = 0;
          }
        }
      }
    }
  }

  const result: Record<string, number> = {};
  for (const assetId of estimatedFiAssetIds) {
    const qty = qtyByAsset.get(assetId) ?? 0;
    const lots = fiLotsByAsset.get(assetId);
    if (qty <= EPSILON || !lots || lots.length === 0) continue;

    const asset = fiAssetById.get(assetId)!;
    const maturityISO = assetMaturityISO.get(assetId) ?? null;
    const taxExempt = Boolean(asset.taxExempt);
    let totalNet = 0;
    for (const lot of lots) {
      totalNet += computeLotNetValueBRL(lot, endDate, maturityISO, taxExempt);
    }
    result[assetId] = round2(totalNet);
  }

  return result;
}

function getRangeStartDate(endDate: string, range: EvolutionRange): string | null {
  switch (range) {
    case "1M":
      return addMonthsISO(endDate, -1);
    case "3M":
      return addMonthsISO(endDate, -3);
    case "6M":
      return addMonthsISO(endDate, -6);
    case "YTD":
      return `${endDate.slice(0, 4)}-01-01`;
    case "1A":
      return addMonthsISO(endDate, -12);
    case "2A":
      return addMonthsISO(endDate, -24);
    case "5A":
      return addMonthsISO(endDate, -60);
    case "ALL":
      return null;
  }
}

function sumClasses(
  point: EvolutionDayPoint,
  classes: AssetClassKey[]
): { marketValueBRL: number; investedCostBRL: number; netContributionBRL: number } {
  let marketValueBRL = 0;
  let investedCostBRL = 0;
  let netContributionBRL = 0;
  for (const cls of classes) {
    const m = point.byClass[cls];
    if (!m) continue;
    marketValueBRL += m.marketValueBRL;
    investedCostBRL += m.investedCostBRL;
    netContributionBRL += m.netContributionBRL;
  }
  return {
    marketValueBRL: round2(marketValueBRL),
    investedCostBRL: round2(investedCostBRL),
    netContributionBRL: round2(netContributionBRL),
  };
}

export function aggregateEvolutionView(
  points: EvolutionDayPoint[],
  options: {
    selectedClasses: AssetClassKey[];
    includeReserve: boolean;
    range: EvolutionRange;
    granularity: EvolutionGranularity;
    contributionGrouping: EvolutionGranularity;
  }
): AggregatedEvolutionResult {
  const {
    selectedClasses,
    includeReserve,
    range,
    granularity,
    contributionGrouping,
  } = options;

  const eligibleClasses: AssetClassKey[] = includeReserve
    ? ALL_ASSET_CLASSES
    : INVESTMENT_CLASSES;

  const filteredSelection = selectedClasses.filter((c) =>
    eligibleClasses.includes(c)
  );
  const activeClasses =
    filteredSelection.length > 0 ? filteredSelection : eligibleClasses;

  if (points.length === 0) {
    return {
      activeClasses,
      evolutionSeries: [],
      contributionSeries: [],
      kpis: {
        currentMarketValueBRL: 0,
        totalInvestedCostBRL: 0,
        totalProfitLossBRL: 0,
        totalProfitLossPct: 0,
        periodContributionBRL: 0,
        periodGainBRL: 0,
        periodReturnPct: 0,
        isSubPeriod: false,
      },
    };
  }

  const firstPointDate = points[0].date;
  const lastPointDate = points[points.length - 1].date;
  const rangeStart = getRangeStartDate(lastPointDate, range);

  let baselinePoint: EvolutionDayPoint | null = null;
  const windowPoints: EvolutionDayPoint[] = [];

  for (const pt of points) {
    if (rangeStart && pt.date < rangeStart) {
      baselinePoint = pt;
    } else {
      windowPoints.push(pt);
    }
  }

  const effectivePoints = windowPoints.length > 0 ? windowPoints : points;
  const isSubPeriod = Boolean(rangeStart && rangeStart > firstPointDate && baselinePoint);

  // Determine whether daily axis labels should include the year
  const spansMultipleYears =
    effectivePoints[0].date.slice(0, 4) !==
    effectivePoints[effectivePoints.length - 1].date.slice(0, 4);

  // 1. Evolution Series (DAILY or MONTHLY)
  const buildPoint = (
    pt: EvolutionDayPoint,
    label: string,
    tooltipLabel: string
  ): AggregatedEvolutionPoint => {
    const sums = sumClasses(pt, activeClasses);
    const profitLossBRL = round2(sums.marketValueBRL - sums.investedCostBRL);
    const profitLossPct =
      sums.investedCostBRL > EPSILON
        ? round2((profitLossBRL / sums.investedCostBRL) * 100)
        : 0;

    const classMarketValue = {} as Record<AssetClassKey, number>;
    const classProfitLoss = {} as Record<AssetClassKey, number>;
    const classProfitLossPct = {} as Record<AssetClassKey, number>;

    for (const cls of ALL_ASSET_CLASSES) {
      const m = pt.byClass[cls];
      const mv = m?.marketValueBRL ?? 0;
      const cost = m?.investedCostBRL ?? 0;
      const pl = round2(mv - cost);
      classMarketValue[cls] = mv;
      classProfitLoss[cls] = pl;
      classProfitLossPct[cls] =
        cost > EPSILON ? round2((pl / cost) * 100) : 0;
    }

    return {
      date: pt.date,
      label,
      tooltipLabel,
      marketValueBRL: sums.marketValueBRL,
      investedCostBRL: sums.investedCostBRL,
      profitLossBRL,
      profitLossPct,
      usdBrl: pt.usdBrl,
      classMarketValue,
      classProfitLoss,
      classProfitLossPct,
    };
  };

  const evolutionSeries: AggregatedEvolutionPoint[] = [];
  if (granularity === "DAILY") {
    for (const pt of effectivePoints) {
      evolutionSeries.push(
        buildPoint(
          pt,
          formatDateAxisPTBR(pt.date, spansMultipleYears),
          formatDateFullPTBR(pt.date)
        )
      );
    }
  } else {
    // Group by YYYY-MM, taking the last point of each month
    const lastByMonth = new Map<string, EvolutionDayPoint>();
    for (const pt of effectivePoints) {
      lastByMonth.set(pt.date.slice(0, 7), pt);
    }
    for (const [ym, pt] of lastByMonth.entries()) {
      evolutionSeries.push(
        buildPoint(pt, formatMonthAxisPTBR(ym), formatMonthFullPTBR(ym))
      );
    }
  }

  // 2. Contribution Series (MONTHLY or DAILY non-zero days)
  const contributionSeries: AggregatedContributionPoint[] = [];
  let periodContributionBRL = 0;

  if (contributionGrouping === "MONTHLY") {
    const byMonth = new Map<string, AggregatedContributionPoint>();
    for (const pt of effectivePoints) {
      const ym = pt.date.slice(0, 7);
      let row = byMonth.get(ym);
      if (!row) {
        row = {
          key: ym,
          label: formatMonthAxisPTBR(ym),
          tooltipLabel: formatMonthFullPTBR(ym),
          totalBRL: 0,
          FIXED_INCOME: 0,
          BR_STOCK: 0,
          BR_FII: 0,
          US_STOCK: 0,
          US_REIT: 0,
          EMERGENCY_RESERVE: 0,
        };
        byMonth.set(ym, row);
      }
      for (const cls of activeClasses) {
        const val = pt.byClass[cls]?.netContributionBRL ?? 0;
        if (Math.abs(val) > EPSILON) {
          row[cls] = round2(row[cls] + val);
          row.totalBRL = round2(row.totalBRL + val);
          periodContributionBRL += val;
        }
      }
    }
    contributionSeries.push(...byMonth.values());
  } else {
    for (const pt of effectivePoints) {
      let dayTotal = 0;
      const row: AggregatedContributionPoint = {
        key: pt.date,
        label: formatDateAxisPTBR(pt.date, spansMultipleYears),
        tooltipLabel: formatDateFullPTBR(pt.date),
        totalBRL: 0,
        FIXED_INCOME: 0,
        BR_STOCK: 0,
        BR_FII: 0,
        US_STOCK: 0,
        US_REIT: 0,
        EMERGENCY_RESERVE: 0,
      };
      for (const cls of activeClasses) {
        const val = pt.byClass[cls]?.netContributionBRL ?? 0;
        if (Math.abs(val) > EPSILON) {
          row[cls] = round2(val);
          dayTotal += val;
        }
      }
      if (Math.abs(dayTotal) > EPSILON) {
        row.totalBRL = round2(dayTotal);
        periodContributionBRL += dayTotal;
        contributionSeries.push(row);
      }
    }
  }

  periodContributionBRL = round2(periodContributionBRL);

  // 3. KPIs
  const lastPoint = effectivePoints[effectivePoints.length - 1];
  const lastSums = sumClasses(lastPoint, activeClasses);
  const totalProfitLossBRL = round2(
    lastSums.marketValueBRL - lastSums.investedCostBRL
  );
  const totalProfitLossPct =
    lastSums.investedCostBRL > EPSILON
      ? round2((totalProfitLossBRL / lastSums.investedCostBRL) * 100)
      : 0;

  let periodGainBRL = totalProfitLossBRL;
  let periodReturnPct = totalProfitLossPct;

  if (isSubPeriod && baselinePoint) {
    const baseSums = sumClasses(baselinePoint, activeClasses);
    periodGainBRL = round2(
      lastSums.marketValueBRL - baseSums.marketValueBRL - periodContributionBRL
    );
    const capitalBase =
      baseSums.marketValueBRL + Math.max(0, periodContributionBRL);
    periodReturnPct =
      capitalBase > EPSILON ? round2((periodGainBRL / capitalBase) * 100) : 0;
  }

  return {
    activeClasses,
    evolutionSeries,
    contributionSeries,
    kpis: {
      currentMarketValueBRL: lastSums.marketValueBRL,
      totalInvestedCostBRL: lastSums.investedCostBRL,
      totalProfitLossBRL,
      totalProfitLossPct,
      periodContributionBRL,
      periodGainBRL,
      periodReturnPct,
      isSubPeriod,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
