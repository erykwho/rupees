import {
  type AssetClassKey,
  type FixedIncomeIndexKey,
  type TransactionInput,
} from "./types";

export type FixedIncomeAssetClassKey = "FIXED_INCOME" | "EMERGENCY_RESERVE";

export type FixedIncomeHorizonKey =
  | "1A"
  | "2A"
  | "5A"
  | "10A"
  | "MAX_MATURITY";

export type FixedIncomeScopeKey = "FIXED_INCOME" | "EMERGENCY_RESERVE" | "ALL";

export interface BenchmarkRates {
  selic: number; // % a.a.
  cdi: number; // % a.a.
  ipca: number; // % a.a. (acumulado 12m)
  updatedAt: string | null;
  source: "bcb" | "cache" | "fallback";
}

export interface FixedIncomeAssetInput {
  id: string;
  ticker: string;
  assetClass: FixedIncomeAssetClassKey;
  sector: string;
  isActive: boolean;
  currentValueBRL: number;
  investedCostBRL: number;
  fixedIncomeIndex: FixedIncomeIndexKey | null;
  fixedIncomeRate: number | null;
  maturityDate: string | null; // "YYYY-MM-DD"
  taxExempt: boolean;
  firstBuyDate: string | null; // "YYYY-MM-DD"
  effectiveContractedRate: number | null;
  hasLotRateOverride: boolean;
  lotsWithRateCount: number;
}

export interface FixedIncomeAssetProjection {
  id: string;
  ticker: string;
  assetClass: FixedIncomeAssetClassKey;
  sector: string;
  isActive: boolean;
  isConfigured: boolean;
  isMatured: boolean;
  currentValueBRL: number;
  investedCostBRL: number;
  fixedIncomeIndex: FixedIncomeIndexKey | null;
  fixedIncomeRate: number | null;
  effectiveContractedRate: number | null;
  hasLotRateOverride: boolean;
  lotsWithRateCount: number;
  maturityDate: string | null;
  daysToMaturity: number | null;
  taxExempt: boolean;
  holdingDaysNow: number;
  currentIrRate: number; // 0..0.225
  annualGrossRatePct: number;
  monthlyGrossRatePct: number;
  monthlyGrossBRL: number;
  monthlyNetBRL: number;
  monthlyIrRate: number;
  annualGrossBRL: number;
  annualNetBRL: number;
  annualIrRate: number;
  maturityGrossValueBRL: number | null;
  maturityNetValueBRL: number | null;
  maturityGrossGainBRL: number | null;
  maturityNetGainBRL: number | null;
  maturityIrRate: number | null;
}

export interface FixedIncomeClassTotals {
  assetClass: FixedIncomeAssetClassKey;
  totalValueBRL: number;
  configuredValueBRL: number;
  unconfiguredCount: number;
  weightedAnnualGrossRatePct: number;
  monthlyGrossBRL: number;
  monthlyNetBRL: number;
  annualGrossBRL: number;
  annualNetBRL: number;
}

export interface FixedIncomeProjectionPoint {
  monthIndex: number;
  date: string; // "YYYY-MM-DD"
  label: string;
  tooltipLabel: string;
  principalBRL: number; // saldo inicial + aportes simulados
  grossValueBRL: number;
  netValueBRL: number;
  grossGainBRL: number;
  netGainBRL: number;
  maturedTickers: string[];
}

export interface FixedIncomeProjectionResult {
  referenceDate: string;
  benchmarks: BenchmarkRates;
  assets: FixedIncomeAssetProjection[];
  unconfiguredAssets: FixedIncomeAssetProjection[];
  fixedIncomeTotals: FixedIncomeClassTotals;
  emergencyReserveTotals: FixedIncomeClassTotals;
  maxMaturityMonths: number | null;
  horizonMonths: number;
  series: FixedIncomeProjectionPoint[];
  finalPoint: FixedIncomeProjectionPoint;
}

export interface FixedIncomeSuggestion {
  fixedIncomeIndex: FixedIncomeIndexKey;
  fixedIncomeRate: number;
  maturityDate: string; // "YYYY-MM-DD" or ""
  taxExempt: boolean;
}

const EPSILON = 1e-8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;
const MAX_PROJECTION_MONTHS = 360; // 30 anos

const MONTHS_PT_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000;
}

function parseIsoDateUTC(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function formatIsoDateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addMonthsUTC(base: Date, months: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + months;
  const d = Math.min(
    base.getUTCDate(),
    new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  );
  return new Date(Date.UTC(y, m, d));
}

function diffDaysUTC(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

/**
 * Tabela regressiva de IR da Renda Fixa no Brasil:
 * - Até 180 dias: 22,5%
 * - 181 a 360 dias: 20,0%
 * - 361 a 720 dias: 17,5%
 * - Acima de 720 dias: 15,0%
 * Ativos isentos (LCI, LCA, CRI, CRA, Debêntures incentivadas): 0%
 */
export function getRegressiveIrRate(
  holdingDays: number,
  taxExempt: boolean
): number {
  if (taxExempt) return 0;
  const days = Math.max(0, holdingDays);
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

/**
 * Calcula a taxa anual bruta equivalente (% a.a.) dado indexador, taxa contratada e benchmarks.
 */
export function computeAnnualGrossRatePct(
  index: FixedIncomeIndexKey,
  contractedRate: number,
  benchmarks: Pick<BenchmarkRates, "selic" | "cdi" | "ipca">
): number {
  const safeRate = Number.isFinite(contractedRate) ? contractedRate : 0;
  const safeSelic = Math.max(0, benchmarks.selic);
  const safeCdi = Math.max(0, benchmarks.cdi);
  const safeIpca = Math.max(0, benchmarks.ipca);

  switch (index) {
    case "CDI_PCT":
      return round4((safeRate / 100) * safeCdi);
    case "CDI_PLUS":
      return round4(((1 + safeCdi / 100) * (1 + safeRate / 100) - 1) * 100);
    case "SELIC_PCT":
      return round4((safeRate / 100) * safeSelic);
    case "SELIC_PLUS":
      return round4(((1 + safeSelic / 100) * (1 + safeRate / 100) - 1) * 100);
    case "IPCA_PLUS":
      return round4(((1 + safeIpca / 100) * (1 + safeRate / 100) - 1) * 100);
    case "PREFIXED":
      return round4(safeRate);
  }
}

/**
 * Calcula a taxa efetiva contratada de um ativo, ponderando aportes (BUY)
 * que tenham taxa específica informada. Lotes sem taxa usam a taxa padrão do ativo.
 */
export function computeEffectiveContractedRate(
  assetDefaultRate: number | null,
  transactions: TransactionInput[]
): {
  effectiveRate: number | null;
  hasLotRateOverride: boolean;
  lotsWithRateCount: number;
  firstBuyDate: string | null;
} {
  const buys = transactions
    .filter((t) => t.type === "BUY" && Math.abs(t.totalAmount) > EPSILON)
    .sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

  const firstBuyDate =
    buys.length > 0
      ? (typeof buys[0].date === "string"
          ? buys[0].date
          : buys[0].date.toISOString()
        ).slice(0, 10)
      : null;

  const lotsWithRate = buys.filter(
    (t) =>
      t.fixedIncomeRate !== undefined &&
      t.fixedIncomeRate !== null &&
      Number.isFinite(t.fixedIncomeRate)
  );

  if (lotsWithRate.length === 0) {
    return {
      effectiveRate: assetDefaultRate,
      hasLotRateOverride: false,
      lotsWithRateCount: 0,
      firstBuyDate,
    };
  }

  let weightedSum = 0;
  let totalWeight = 0;

  for (const tx of buys) {
    const rate =
      tx.fixedIncomeRate !== undefined && tx.fixedIncomeRate !== null
        ? tx.fixedIncomeRate
        : assetDefaultRate;
    if (rate === null || !Number.isFinite(rate)) continue;
    const weight = Math.abs(tx.totalAmount);
    weightedSum += rate * weight;
    totalWeight += weight;
  }

  return {
    effectiveRate:
      totalWeight > EPSILON ? round4(weightedSum / totalWeight) : assetDefaultRate,
    hasLotRateOverride: true,
    lotsWithRateCount: lotsWithRate.length,
    firstBuyDate,
  };
}

/**
 * Formata a taxa contratada para exibição legível (ex: "100% CDI", "IPCA + 6,50%", "12,50% a.a.").
 */
export function formatFixedIncomeRate(
  index: FixedIncomeIndexKey | null,
  rate: number | null
): string {
  if (!index || rate === null || !Number.isFinite(rate)) {
    return "Não configurado";
  }

  const formatted = rate.toLocaleString("pt-BR", {
    minimumFractionDigits: index === "CDI_PCT" || index === "SELIC_PCT" ? 0 : 2,
    maximumFractionDigits: 2,
  });

  switch (index) {
    case "CDI_PCT":
      return `${formatted}% CDI`;
    case "CDI_PLUS":
      return `CDI + ${formatted}%`;
    case "SELIC_PCT":
      return `${formatted}% Selic`;
    case "SELIC_PLUS":
      return `Selic + ${formatted}%`;
    case "IPCA_PLUS":
      return `IPCA + ${formatted}%`;
    case "PREFIXED":
      return `${formatted}% a.a.`;
  }
}

/**
 * Sugere uma configuração inicial para backfill guiado com base no ticker e classe.
 */
export function suggestFixedIncomeConfig(
  ticker: string,
  assetClass: AssetClassKey
): FixedIncomeSuggestion {
  const upper = ticker.trim().toUpperCase();
  const yearMatch = upper.match(/\b(20[2-9]\d)\b/);
  const suggestedMaturity = yearMatch ? `${yearMatch[1]}-08-15` : "";
  const isTaxExemptName = /\b(LCI|LCA|CRI|CRA|DEBENTURE|INCENTIVAD)/.test(upper);

  if (upper.includes("IPCA")) {
    return {
      fixedIncomeIndex: "IPCA_PLUS",
      fixedIncomeRate: 6.5,
      maturityDate: suggestedMaturity,
      taxExempt: isTaxExemptName,
    };
  }

  if (upper.includes("SELIC") || assetClass === "EMERGENCY_RESERVE") {
    return {
      fixedIncomeIndex: "SELIC_PCT",
      fixedIncomeRate: 100,
      maturityDate: suggestedMaturity,
      taxExempt: false,
    };
  }

  if (isTaxExemptName) {
    return {
      fixedIncomeIndex: "CDI_PCT",
      fixedIncomeRate: 90,
      maturityDate: suggestedMaturity,
      taxExempt: true,
    };
  }

  if (upper.includes("PRE")) {
    return {
      fixedIncomeIndex: "PREFIXED",
      fixedIncomeRate: 12.5,
      maturityDate: suggestedMaturity,
      taxExempt: false,
    };
  }

  return {
    fixedIncomeIndex: "CDI_PCT",
    fixedIncomeRate: 100,
    maturityDate: suggestedMaturity,
    taxExempt: false,
  };
}

export function formatMaturityDatePTBR(isoDate: string | null): string {
  if (!isoDate) return "Liquidez diária";
  const [y, m, d] = isoDate.slice(0, 10).split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function computeCompoundGain(
  principal: number,
  annualRatePct: number,
  days: number
): number {
  if (principal <= EPSILON || days <= 0 || annualRatePct <= 0) return 0;
  return principal * (Math.pow(1 + annualRatePct / 100, days / DAYS_PER_YEAR) - 1);
}

function buildClassTotals(
  assetClass: FixedIncomeAssetClassKey,
  projections: FixedIncomeAssetProjection[]
): FixedIncomeClassTotals {
  const items = projections.filter((a) => a.assetClass === assetClass);
  const totalValueBRL = items.reduce((s, a) => s + a.currentValueBRL, 0);
  const configured = items.filter((a) => a.isConfigured);
  const configuredValueBRL = configured.reduce(
    (s, a) => s + a.currentValueBRL,
    0
  );
  const activeYielding = configured.filter(
    (a) => !a.isMatured && a.currentValueBRL > EPSILON
  );
  const activeYieldingValue = activeYielding.reduce(
    (s, a) => s + a.currentValueBRL,
    0
  );

  const weightedAnnualGrossRatePct =
    activeYieldingValue > EPSILON
      ? activeYielding.reduce(
          (s, a) => s + a.annualGrossRatePct * a.currentValueBRL,
          0
        ) / activeYieldingValue
      : 0;

  return {
    assetClass,
    totalValueBRL: round2(totalValueBRL),
    configuredValueBRL: round2(configuredValueBRL),
    unconfiguredCount: items.filter((a) => !a.isConfigured && a.isActive).length,
    weightedAnnualGrossRatePct: round2(weightedAnnualGrossRatePct),
    monthlyGrossBRL: round2(
      configured.reduce((s, a) => s + a.monthlyGrossBRL, 0)
    ),
    monthlyNetBRL: round2(configured.reduce((s, a) => s + a.monthlyNetBRL, 0)),
    annualGrossBRL: round2(
      configured.reduce((s, a) => s + a.annualGrossBRL, 0)
    ),
    annualNetBRL: round2(configured.reduce((s, a) => s + a.annualNetBRL, 0)),
  };
}

export function computeFixedIncomeProjection(params: {
  assets: FixedIncomeAssetInput[];
  benchmarks: BenchmarkRates;
  horizon?: FixedIncomeHorizonKey;
  scope?: FixedIncomeScopeKey;
  monthlyContributionBRL?: number;
  referenceDate?: string; // "YYYY-MM-DD"
}): FixedIncomeProjectionResult {
  const {
    assets,
    benchmarks,
    horizon = "1A",
    scope = "FIXED_INCOME",
    monthlyContributionBRL = 0,
    referenceDate = new Date().toISOString().slice(0, 10),
  } = params;

  const refDate = parseIsoDateUTC(referenceDate);
  const safeContribution = Math.max(0, monthlyContributionBRL);

  // 1. Per-asset projections
  const assetProjections: FixedIncomeAssetProjection[] = assets.map((asset) => {
    const isConfigured =
      asset.fixedIncomeIndex !== null &&
      asset.effectiveContractedRate !== null &&
      Number.isFinite(asset.effectiveContractedRate);

    const holdingDaysNow = asset.firstBuyDate
      ? Math.max(0, Math.floor(diffDaysUTC(parseIsoDateUTC(asset.firstBuyDate), refDate)))
      : 0;

    const maturityDateObj = asset.maturityDate
      ? parseIsoDateUTC(asset.maturityDate)
      : null;
    const rawDaysToMaturity = maturityDateObj
      ? Math.ceil(diffDaysUTC(refDate, maturityDateObj))
      : null;
    const isMatured = rawDaysToMaturity !== null && rawDaysToMaturity <= 0;
    const daysToMaturity =
      rawDaysToMaturity !== null ? Math.max(0, rawDaysToMaturity) : null;

    const currentIrRate = getRegressiveIrRate(holdingDaysNow, asset.taxExempt);

    if (!isConfigured || asset.fixedIncomeIndex === null || asset.effectiveContractedRate === null) {
      return {
        id: asset.id,
        ticker: asset.ticker,
        assetClass: asset.assetClass,
        sector: asset.sector,
        isActive: asset.isActive,
        isConfigured: false,
        isMatured,
        currentValueBRL: round2(asset.currentValueBRL),
        investedCostBRL: round2(asset.investedCostBRL),
        fixedIncomeIndex: asset.fixedIncomeIndex,
        fixedIncomeRate: asset.fixedIncomeRate,
        effectiveContractedRate: asset.effectiveContractedRate,
        hasLotRateOverride: asset.hasLotRateOverride,
        lotsWithRateCount: asset.lotsWithRateCount,
        maturityDate: asset.maturityDate,
        daysToMaturity,
        taxExempt: asset.taxExempt,
        holdingDaysNow,
        currentIrRate,
        annualGrossRatePct: 0,
        monthlyGrossRatePct: 0,
        monthlyGrossBRL: 0,
        monthlyNetBRL: 0,
        monthlyIrRate: currentIrRate,
        annualGrossBRL: 0,
        annualNetBRL: 0,
        annualIrRate: currentIrRate,
        maturityGrossValueBRL: null,
        maturityNetValueBRL: null,
        maturityGrossGainBRL: null,
        maturityNetGainBRL: null,
        maturityIrRate: null,
      };
    }

    const annualGrossRatePct = computeAnnualGrossRatePct(
      asset.fixedIncomeIndex,
      asset.effectiveContractedRate,
      benchmarks
    );
    const monthlyGrossRatePct = round4(
      (Math.pow(1 + annualGrossRatePct / 100, 1 / 12) - 1) * 100
    );

    const monthDays =
      daysToMaturity !== null
        ? Math.min(DAYS_PER_MONTH, daysToMaturity)
        : DAYS_PER_MONTH;
    const yearDays =
      daysToMaturity !== null
        ? Math.min(DAYS_PER_YEAR, daysToMaturity)
        : DAYS_PER_YEAR;

    const monthlyGrossBRL = isMatured
      ? 0
      : computeCompoundGain(asset.currentValueBRL, annualGrossRatePct, monthDays);
    const monthlyIrRate = getRegressiveIrRate(
      holdingDaysNow + monthDays,
      asset.taxExempt
    );
    const monthlyNetBRL = monthlyGrossBRL * (1 - monthlyIrRate);

    const annualGrossBRL = isMatured
      ? 0
      : computeCompoundGain(asset.currentValueBRL, annualGrossRatePct, yearDays);
    const annualIrRate = getRegressiveIrRate(
      holdingDaysNow + yearDays,
      asset.taxExempt
    );
    const annualNetBRL = annualGrossBRL * (1 - annualIrRate);

    let maturityGrossValueBRL: number | null = null;
    let maturityNetValueBRL: number | null = null;
    let maturityGrossGainBRL: number | null = null;
    let maturityNetGainBRL: number | null = null;
    let maturityIrRate: number | null = null;

    if (daysToMaturity !== null) {
      const mGain = isMatured
        ? 0
        : computeCompoundGain(
            asset.currentValueBRL,
            annualGrossRatePct,
            daysToMaturity
          );
      maturityIrRate = getRegressiveIrRate(
        holdingDaysNow + daysToMaturity,
        asset.taxExempt
      );
      const mNetGain = mGain * (1 - maturityIrRate);
      maturityGrossGainBRL = round2(mGain);
      maturityNetGainBRL = round2(mNetGain);
      maturityGrossValueBRL = round2(asset.currentValueBRL + mGain);
      maturityNetValueBRL = round2(asset.currentValueBRL + mNetGain);
    }

    return {
      id: asset.id,
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      sector: asset.sector,
      isActive: asset.isActive,
      isConfigured: true,
      isMatured,
      currentValueBRL: round2(asset.currentValueBRL),
      investedCostBRL: round2(asset.investedCostBRL),
      fixedIncomeIndex: asset.fixedIncomeIndex,
      fixedIncomeRate: asset.fixedIncomeRate,
      effectiveContractedRate: asset.effectiveContractedRate,
      hasLotRateOverride: asset.hasLotRateOverride,
      lotsWithRateCount: asset.lotsWithRateCount,
      maturityDate: asset.maturityDate,
      daysToMaturity,
      taxExempt: asset.taxExempt,
      holdingDaysNow,
      currentIrRate,
      annualGrossRatePct: round2(annualGrossRatePct),
      monthlyGrossRatePct: round2(monthlyGrossRatePct),
      monthlyGrossBRL: round2(monthlyGrossBRL),
      monthlyNetBRL: round2(monthlyNetBRL),
      monthlyIrRate,
      annualGrossBRL: round2(annualGrossBRL),
      annualNetBRL: round2(annualNetBRL),
      annualIrRate,
      maturityGrossValueBRL,
      maturityNetValueBRL,
      maturityGrossGainBRL,
      maturityNetGainBRL,
      maturityIrRate,
    };
  });

  const unconfiguredAssets = assetProjections.filter(
    (a) => !a.isConfigured && a.isActive
  );

  const fixedIncomeTotals = buildClassTotals("FIXED_INCOME", assetProjections);
  const emergencyReserveTotals = buildClassTotals(
    "EMERGENCY_RESERVE",
    assetProjections
  );

  // 2. Scope filtering for chart simulation
  const scopedAssets = assetProjections.filter((a) => {
    if (!a.isConfigured) return false;
    if (a.currentValueBRL <= EPSILON && !a.isActive) return false;
    if (scope === "ALL") return true;
    return a.assetClass === scope;
  });

  const maxMaturityDays = scopedAssets.reduce<number | null>((max, a) => {
    if (a.daysToMaturity === null || a.daysToMaturity <= 0) return max;
    return max === null ? a.daysToMaturity : Math.max(max, a.daysToMaturity);
  }, null);

  const maxMaturityMonths =
    maxMaturityDays !== null
      ? Math.min(MAX_PROJECTION_MONTHS, Math.max(1, Math.ceil(maxMaturityDays / DAYS_PER_MONTH)))
      : null;

  const horizonMonths = (() => {
    switch (horizon) {
      case "1A":
        return 12;
      case "2A":
        return 24;
      case "5A":
        return 60;
      case "10A":
        return 120;
      case "MAX_MATURITY":
        return maxMaturityMonths ?? 60;
    }
  })();

  // 3. Monthly timeline simulation (with post-maturity freeze)
  // Track each asset's running gross balance, cumulative contributions, and frozen state upon maturity.
  interface SimState {
    asset: FixedIncomeAssetProjection;
    maturityDateObj: Date | null;
    grossValue: number;
    principal: number;
    frozen: boolean;
    frozenNetValue: number;
    frozenGrossValue: number;
  }

  const states: SimState[] = scopedAssets.map((asset) => {
    const maturityDateObj = asset.maturityDate
      ? parseIsoDateUTC(asset.maturityDate)
      : null;
    return {
      asset,
      maturityDateObj,
      grossValue: asset.currentValueBRL,
      principal: asset.currentValueBRL,
      frozen: asset.isMatured,
      frozenNetValue: asset.currentValueBRL,
      frozenGrossValue: asset.currentValueBRL,
    };
  });

  const series: FixedIncomeProjectionPoint[] = [];

  for (let m = 0; m <= horizonMonths; m++) {
    const pointDate = addMonthsUTC(refDate, m);
    const pointIso = formatIsoDateUTC(pointDate);
    const prevDate = m > 0 ? addMonthsUTC(refDate, m - 1) : refDate;
    const maturedThisMonth: string[] = [];

    if (m > 0) {
      // Determine active non-frozen assets for monthly contribution distribution
      const openStates = states.filter((st) => !st.frozen);
      const openStartBalances = new Map(
        openStates.map((st) => [st, Math.max(0, st.grossValue)])
      );
      const openWeightSum = openStates.reduce(
        (s, st) => s + (openStartBalances.get(st) ?? 0),
        0
      );

      for (const st of states) {
        if (st.frozen) continue;

        const stepDays = Math.max(1, diffDaysUTC(prevDate, pointDate));
        const matDate = st.maturityDateObj;

        // Check if maturing during this step
        if (matDate && pointDate >= matDate) {
          const daysUntilMat = Math.max(0, diffDaysUTC(prevDate, matDate));
          if (daysUntilMat > 0) {
            const gain = computeCompoundGain(
              st.grossValue,
              st.asset.annualGrossRatePct,
              daysUntilMat
            );
            st.grossValue += gain;
          }
          const totalHoldingDays =
            st.asset.holdingDaysNow + Math.max(0, diffDaysUTC(refDate, matDate));
          const irRate = getRegressiveIrRate(
            totalHoldingDays,
            st.asset.taxExempt
          );
          const totalProjectedGain = Math.max(0, st.grossValue - st.principal);
          st.frozenGrossValue = st.grossValue;
          st.frozenNetValue =
            st.principal + totalProjectedGain * (1 - irRate);
          st.frozen = true;
          maturedThisMonth.push(st.asset.ticker);
        } else {
          // Accrue full month
          const gain = computeCompoundGain(
            st.grossValue,
            st.asset.annualGrossRatePct,
            stepDays
          );
          st.grossValue += gain;

          // Inject simulated monthly contribution proportionally across non-matured assets
          if (safeContribution > 0 && openStates.length > 0) {
            const baseVal = openStartBalances.get(st) ?? 0;
            const weight =
              openWeightSum > EPSILON
                ? baseVal / openWeightSum
                : 1 / openStates.length;
            const share = safeContribution * weight;
            st.grossValue += share;
            st.principal += share;
          }
        }
      }
    }

    let totalPrincipal = 0;
    let totalGross = 0;
    let totalNet = 0;
    const elapsedDays = Math.max(0, diffDaysUTC(refDate, pointDate));

    for (const st of states) {
      totalPrincipal += st.principal;
      if (st.frozen) {
        totalGross += st.frozenGrossValue;
        totalNet += st.frozenNetValue;
      } else {
        totalGross += st.grossValue;
        const gain = Math.max(0, st.grossValue - st.principal);
        const irRate = getRegressiveIrRate(
          st.asset.holdingDaysNow + elapsedDays,
          st.asset.taxExempt
        );
        totalNet += st.principal + gain * (1 - irRate);
      }
    }

    const monthShort = MONTHS_PT_SHORT[pointDate.getUTCMonth()];
    const yearShort = String(pointDate.getUTCFullYear()).slice(-2);
    const label = m === 0 ? "Hoje" : `${monthShort}/${yearShort}`;
    const tooltipLabel =
      m === 0
        ? "Saldo atual (Hoje)"
        : `${monthShort[0].toUpperCase()}${monthShort.slice(1)}/${pointDate.getUTCFullYear()} (${m} ${m === 1 ? "mês" : "meses"})`;

    series.push({
      monthIndex: m,
      date: pointIso,
      label,
      tooltipLabel,
      principalBRL: round2(totalPrincipal),
      grossValueBRL: round2(totalGross),
      netValueBRL: round2(totalNet),
      grossGainBRL: round2(totalGross - totalPrincipal),
      netGainBRL: round2(totalNet - totalPrincipal),
      maturedTickers: maturedThisMonth,
    });
  }

  const finalPoint =
    series[series.length - 1] ?? {
      monthIndex: 0,
      date: referenceDate,
      label: "Hoje",
      tooltipLabel: "Saldo atual (Hoje)",
      principalBRL: 0,
      grossValueBRL: 0,
      netValueBRL: 0,
      grossGainBRL: 0,
      netGainBRL: 0,
      maturedTickers: [],
    };

  return {
    referenceDate,
    benchmarks,
    assets: assetProjections,
    unconfiguredAssets,
    fixedIncomeTotals,
    emergencyReserveTotals,
    maxMaturityMonths,
    horizonMonths,
    series,
    finalPoint,
  };
}
