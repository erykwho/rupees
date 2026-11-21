import {
  ALL_ASSET_CLASSES,
  type AssetClassKey,
  INVESTMENT_CLASSES,
} from "./types";
import { type EvolutionDayPoint, addMonthsISO } from "./evolution";

const EPSILON = 1e-8;
const DEFAULT_FALLBACK_RETURN_PCT = 10;
const MIN_HISTORY_DAYS_FOR_DEFAULT = 90;
const MIN_HISTORY_DAYS_FOR_DISPLAY = 30;
const MAX_REASONABLE_ANNUAL_RETURN_PCT = 50;

export type ContributionAverageWindow = 3 | 6 | 12;

export const CONTRIBUTION_AVERAGE_WINDOWS: ContributionAverageWindow[] = [
  3, 6, 12,
];

export type ReturnFallbackReason =
  | "none"
  | "short_history"
  | "non_positive"
  | "outlier";

export interface ProjectionBaseline {
  currentValueBRL: number;
  investedOnlyValueBRL: number;
  reserveValueBRL: number;
  averageMonthlyContribution: Record<ContributionAverageWindow, number>;
  monthsUsedByWindow: Record<ContributionAverageWindow, number>;
  closedMonthsAvailable: number;
  historicalAnnualReturnPct: number | null;
  historicalDays: number;
  defaultAnnualReturnPct: number;
  usedFallbackReturn: boolean;
  fallbackReason: ReturnFallbackReason;
  referenceDate: string | null;
}

export interface LongTermProjectionInput {
  initialValueBRL: number;
  monthlyContributionBRL: number;
  annualReturnPct: number;
  annualInflationPct: number;
  horizonYears: number;
  adjustContributionForInflation: boolean;
  startDateISO?: string;
}

export interface LongTermProjectionPoint {
  month: number;
  year: number;
  date: string; // "YYYY-MM-DD"
  label: string; // X-axis label ("Hoje", "2027", "Nov/27", etc.)
  tooltipLabel: string; // Full label ("Hoje (Nov/2026)", "Ano 5 (Nov/2031)")
  nominalBalanceBRL: number;
  realBalanceBRL: number;
  nominalContributedBRL: number;
  realContributedBRL: number;
  nominalInterestBRL: number;
  realInterestBRL: number;
  monthlyContributionNominalBRL: number;
  monthlyContributionRealBRL: number;
  cpiFactor: number;
}

export interface LongTermYearlyRow {
  year: number;
  calendarYear: number;
  date: string;
  nominalBalanceBRL: number;
  realBalanceBRL: number;
  nominalContributedBRL: number;
  realContributedBRL: number;
  nominalInterestBRL: number;
  realInterestBRL: number;
  annualContributionNominalBRL: number;
  annualContributionRealBRL: number;
  monthlyPassiveIncomeRealBRL: number;
}

export interface ProjectionMilestone {
  targetBRL: number;
  label: string;
  year: number;
  month: number;
  calendarYear: number;
}

export interface LongTermProjectionSummary {
  initialValueBRL: number;
  horizonYears: number;
  finalNominalBRL: number;
  finalRealBRL: number;
  totalContributedNominalBRL: number;
  totalContributedRealBRL: number;
  totalInterestNominalBRL: number;
  totalInterestRealBRL: number;
  realGainPct: number;
  nominalGainPct: number;
  realAnnualReturnPct: number;
  monthlyRealRatePct: number;
  estimatedMonthlyPassiveIncomeRealBRL: number;
  estimatedMonthlyPassiveIncomeNominalBRL: number;
  purchasingPowerLossPct: number;
  finalCpiFactor: number;
  finalMonthlyContributionNominalBRL: number;
}

export interface LongTermProjectionResult {
  points: LongTermProjectionPoint[];
  yearlyRows: LongTermYearlyRow[];
  milestones: ProjectionMilestone[];
  summary: LongTermProjectionSummary;
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

const MILESTONE_TARGETS: Array<{ value: number; label: string }> = [
  { value: 100_000, label: "R$ 100 mil" },
  { value: 250_000, label: "R$ 250 mil" },
  { value: 500_000, label: "R$ 500 mil" },
  { value: 1_000_000, label: "R$ 1 milhão" },
  { value: 2_000_000, label: "R$ 2 milhões" },
  { value: 5_000_000, label: "R$ 5 milhões" },
  { value: 10_000_000, label: "R$ 10 milhões" },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isLastDayOfMonthISO(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.getUTCMonth() !== m - 1;
}

function daysBetweenISO(startISO: string, endISO: string): number {
  const [y1, m1, d1] = startISO.split("-").map(Number);
  const [y2, m2, d2] = endISO.split("-").map(Number);
  const t1 = Date.UTC(y1, m1 - 1, d1);
  const t2 = Date.UTC(y2, m2 - 1, d2);
  return Math.max(0, Math.round((t2 - t1) / 86_400_000));
}

function formatMonthYearShort(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES_SHORT[idx] ?? m}/${y.slice(2)}`;
}

function formatMonthYearFull(isoDate: string): string {
  const [y, m] = isoDate.split("-");
  const idx = Number(m) - 1;
  return `${MONTH_NAMES_SHORT[idx] ?? m}/${y}`;
}

function sumClassValues(
  point: EvolutionDayPoint,
  classes: AssetClassKey[]
): { marketValueBRL: number; netContributionBRL: number } {
  let marketValueBRL = 0;
  let netContributionBRL = 0;
  for (const cls of classes) {
    const m = point.byClass[cls];
    if (!m) continue;
    marketValueBRL += m.marketValueBRL;
    netContributionBRL += m.netContributionBRL;
  }
  return { marketValueBRL, netContributionBRL };
}

/**
 * Computes exact real annual return using the Fisher equation:
 * (1 + r_real) = (1 + r_nominal) / (1 + inflation)
 */
export function computeRealAnnualRatePct(
  annualReturnPct: number,
  annualInflationPct: number
): number {
  const nominalFactor = 1 + annualReturnPct / 100;
  const inflationFactor = 1 + annualInflationPct / 100;
  if (inflationFactor <= EPSILON) return annualReturnPct;
  return (nominalFactor / inflationFactor - 1) * 100;
}

/**
 * Extracts live portfolio defaults from daily EvolutionData points:
 * - Current portfolio value (with and without Emergency Reserve)
 * - Average net monthly contributions over the last 3, 6, and 12 closed months
 * - Annualized historical Time-Weighted Return (TWR) with safe fallback to 10% a.a.
 */
export function extractProjectionBaseline(
  points: EvolutionDayPoint[],
  options: { includeReserve?: boolean } = {}
): ProjectionBaseline {
  const includeReserve = options.includeReserve ?? false;
  const activeClasses: AssetClassKey[] = includeReserve
    ? ALL_ASSET_CLASSES
    : INVESTMENT_CLASSES;

  if (points.length === 0) {
    return {
      currentValueBRL: 0,
      investedOnlyValueBRL: 0,
      reserveValueBRL: 0,
      averageMonthlyContribution: { 3: 0, 6: 0, 12: 0 },
      monthsUsedByWindow: { 3: 0, 6: 0, 12: 0 },
      closedMonthsAvailable: 0,
      historicalAnnualReturnPct: null,
      historicalDays: 0,
      defaultAnnualReturnPct: DEFAULT_FALLBACK_RETURN_PCT,
      usedFallbackReturn: true,
      fallbackReason: "short_history",
      referenceDate: null,
    };
  }

  const lastPoint = points[points.length - 1];
  const investedOnlyValueBRL = round2(
    sumClassValues(lastPoint, INVESTMENT_CLASSES).marketValueBRL
  );
  const reserveValueBRL = round2(
    lastPoint.byClass.EMERGENCY_RESERVE?.marketValueBRL ?? 0
  );
  const currentValueBRL = round2(
    includeReserve ? investedOnlyValueBRL + reserveValueBRL : investedOnlyValueBRL
  );

  // Aggregate net contributions by calendar month ("YYYY-MM")
  const monthlyContributions = new Map<string, number>();
  for (const pt of points) {
    const ym = pt.date.slice(0, 7);
    const { netContributionBRL } = sumClassValues(pt, activeClasses);
    monthlyContributions.set(
      ym,
      (monthlyContributions.get(ym) ?? 0) + netContributionBRL
    );
  }

  const sortedMonths = Array.from(monthlyContributions.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  const lastMonthKey = lastPoint.date.slice(0, 7);
  const lastMonthIsClosed = isLastDayOfMonthISO(lastPoint.date);
  const closedMonths = lastMonthIsClosed
    ? sortedMonths
    : sortedMonths.filter(([ym]) => ym !== lastMonthKey);

  // If the user has no closed months yet, fall back to all available months
  const effectiveMonths =
    closedMonths.length > 0 ? closedMonths : sortedMonths;

  const averageMonthlyContribution: Record<ContributionAverageWindow, number> =
    { 3: 0, 6: 0, 12: 0 };
  const monthsUsedByWindow: Record<ContributionAverageWindow, number> = {
    3: 0,
    6: 0,
    12: 0,
  };

  for (const win of CONTRIBUTION_AVERAGE_WINDOWS) {
    const slice = effectiveMonths.slice(-win);
    monthsUsedByWindow[win] = slice.length;
    if (slice.length === 0) {
      averageMonthlyContribution[win] = 0;
    } else {
      const sum = slice.reduce((acc, [, val]) => acc + val, 0);
      averageMonthlyContribution[win] = round2(Math.max(0, sum / slice.length));
    }
  }

  // Compute Time-Weighted Return (TWR) annualized across active classes
  let twrFactor = 1;
  let prevValue = 0;
  let firstActiveDate: string | null = null;
  let lastActiveDate: string | null = null;

  for (const pt of points) {
    const { marketValueBRL, netContributionBRL } = sumClassValues(
      pt,
      activeClasses
    );

    if (firstActiveDate === null) {
      if (marketValueBRL > 10) {
        firstActiveDate = pt.date;
        lastActiveDate = pt.date;
        prevValue = marketValueBRL;
      }
      continue;
    }

    if (prevValue > 10) {
      const endValueExFlow = marketValueBRL - netContributionBRL;
      if (endValueExFlow > 0) {
        const dailyFactor = clamp(endValueExFlow / prevValue, 0.5, 2.0);
        twrFactor *= dailyFactor;
      }
    }

    if (marketValueBRL > 10) {
      lastActiveDate = pt.date;
    }
    prevValue = marketValueBRL;
  }

  const historicalDays =
    firstActiveDate && lastActiveDate
      ? daysBetweenISO(firstActiveDate, lastActiveDate)
      : 0;

  let historicalAnnualReturnPct: number | null = null;
  if (historicalDays >= MIN_HISTORY_DAYS_FOR_DISPLAY && twrFactor > 0) {
    const annualized =
      (Math.pow(twrFactor, 365 / historicalDays) - 1) * 100;
    if (Number.isFinite(annualized)) {
      historicalAnnualReturnPct = round2(annualized);
    }
  }

  let defaultAnnualReturnPct = DEFAULT_FALLBACK_RETURN_PCT;
  let usedFallbackReturn = true;
  let fallbackReason: ReturnFallbackReason = "short_history";

  if (
    historicalDays >= MIN_HISTORY_DAYS_FOR_DEFAULT &&
    historicalAnnualReturnPct !== null
  ) {
    if (historicalAnnualReturnPct <= 0) {
      fallbackReason = "non_positive";
    } else if (historicalAnnualReturnPct > MAX_REASONABLE_ANNUAL_RETURN_PCT) {
      fallbackReason = "outlier";
    } else {
      defaultAnnualReturnPct = historicalAnnualReturnPct;
      usedFallbackReturn = false;
      fallbackReason = "none";
    }
  }

  return {
    currentValueBRL,
    investedOnlyValueBRL,
    reserveValueBRL,
    averageMonthlyContribution,
    monthsUsedByWindow,
    closedMonthsAvailable: closedMonths.length,
    historicalAnnualReturnPct,
    historicalDays,
    defaultAnnualReturnPct,
    usedFallbackReturn,
    fallbackReason,
    referenceDate: lastPoint.date,
  };
}

/**
 * Computes long-term wealth projection with monthly compounding and exact
 * inflation discounting (real purchasing power in today's BRL vs. nominal future BRL).
 */
export function computeLongTermProjection(
  input: LongTermProjectionInput
): LongTermProjectionResult {
  const initialValueBRL = Math.max(0, Number.isFinite(input.initialValueBRL) ? input.initialValueBRL : 0);
  const monthlyContributionBRL = Math.max(
    0,
    Number.isFinite(input.monthlyContributionBRL)
      ? input.monthlyContributionBRL
      : 0
  );
  const annualReturnPct = clamp(
    Number.isFinite(input.annualReturnPct) ? input.annualReturnPct : 0,
    -99,
    200
  );
  const annualInflationPct = clamp(
    Number.isFinite(input.annualInflationPct) ? input.annualInflationPct : 0,
    -50,
    100
  );
  const horizonYears = clamp(Math.round(input.horizonYears || 1), 1, 50);
  const adjustContributionForInflation = input.adjustContributionForInflation;
  const startDateISO =
    input.startDateISO ?? new Date().toISOString().slice(0, 10);

  const totalMonths = horizonYears * 12;
  const monthlyNominalRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const monthlyInflationRate =
    Math.pow(1 + annualInflationPct / 100, 1 / 12) - 1;
  const realAnnualReturnPct = computeRealAnnualRatePct(
    annualReturnPct,
    annualInflationPct
  );
  const monthlyRealRate =
    Math.pow(1 + realAnnualReturnPct / 100, 1 / 12) - 1;

  // Choose chart sampling interval so the chart stays crisp across 1..50 years
  const sampleEveryMonths =
    horizonYears <= 2 ? 1 : horizonYears <= 5 ? 3 : 12;

  const points: LongTermProjectionPoint[] = [];
  const yearlyRows: LongTermYearlyRow[] = [];
  const milestones: ProjectionMilestone[] = [];
  const remainingMilestones = MILESTONE_TARGETS.filter(
    (m) => m.value > initialValueBRL + EPSILON
  );
  let nextMilestoneIdx = 0;

  let nominalBalance = initialValueBRL;
  let nominalContributed = initialValueBRL;
  let realContributed = initialValueBRL;
  let annualContribNominal = 0;
  let annualContribReal = 0;
  let lastMonthlyContributionNominal = monthlyContributionBRL;

  points.push({
    month: 0,
    year: 0,
    date: startDateISO,
    label: "Hoje",
    tooltipLabel: `Hoje (${formatMonthYearFull(startDateISO)})`,
    nominalBalanceBRL: round2(initialValueBRL),
    realBalanceBRL: round2(initialValueBRL),
    nominalContributedBRL: round2(initialValueBRL),
    realContributedBRL: round2(initialValueBRL),
    nominalInterestBRL: 0,
    realInterestBRL: 0,
    monthlyContributionNominalBRL: round2(monthlyContributionBRL),
    monthlyContributionRealBRL: round2(monthlyContributionBRL),
    cpiFactor: 1,
  });

  for (let m = 1; m <= totalMonths; m++) {
    const cpiFactor = Math.pow(1 + monthlyInflationRate, m);
    const contribNominal = adjustContributionForInflation
      ? monthlyContributionBRL * cpiFactor
      : monthlyContributionBRL;
    const contribReal = cpiFactor > EPSILON ? contribNominal / cpiFactor : contribNominal;

    nominalBalance = nominalBalance * (1 + monthlyNominalRate) + contribNominal;
    nominalContributed += contribNominal;
    realContributed += contribReal;
    annualContribNominal += contribNominal;
    annualContribReal += contribReal;
    lastMonthlyContributionNominal = contribNominal;

    const realBalance =
      cpiFactor > EPSILON ? nominalBalance / cpiFactor : nominalBalance;
    const nominalInterest = nominalBalance - nominalContributed;
    const realInterest = realBalance - realContributed;

    const dateISO = addMonthsISO(startDateISO, m);
    const calendarYear = Number(dateISO.slice(0, 4));
    const yearNum = m / 12;

    // Track real purchasing power milestones
    while (
      nextMilestoneIdx < remainingMilestones.length &&
      realBalance >= remainingMilestones[nextMilestoneIdx].value
    ) {
      const target = remainingMilestones[nextMilestoneIdx];
      milestones.push({
        targetBRL: target.value,
        label: target.label,
        year: Math.ceil(m / 12),
        month: m,
        calendarYear,
      });
      nextMilestoneIdx++;
    }

    if (m % sampleEveryMonths === 0 || m === totalMonths) {
      const isExactYear = m % 12 === 0;
      const yearInt = Math.floor(m / 12);
      const remMonths = m % 12;
      const label =
        sampleEveryMonths === 12
          ? String(calendarYear)
          : formatMonthYearShort(dateISO);
      const tooltipLabel = isExactYear
        ? `Ano ${yearInt} (${formatMonthYearFull(dateISO)})`
        : yearInt > 0
          ? `${yearInt}a ${remMonths}m (${formatMonthYearFull(dateISO)})`
          : `${remMonths}m (${formatMonthYearFull(dateISO)})`;

      points.push({
        month: m,
        year: round2(yearNum),
        date: dateISO,
        label,
        tooltipLabel,
        nominalBalanceBRL: round2(nominalBalance),
        realBalanceBRL: round2(realBalance),
        nominalContributedBRL: round2(nominalContributed),
        realContributedBRL: round2(realContributed),
        nominalInterestBRL: round2(nominalInterest),
        realInterestBRL: round2(realInterest),
        monthlyContributionNominalBRL: round2(contribNominal),
        monthlyContributionRealBRL: round2(contribReal),
        cpiFactor,
      });
    }

    if (m % 12 === 0) {
      const yearInt = m / 12;
      const passiveReal =
        monthlyRealRate > 0 ? realBalance * monthlyRealRate : 0;

      yearlyRows.push({
        year: yearInt,
        calendarYear,
        date: dateISO,
        nominalBalanceBRL: round2(nominalBalance),
        realBalanceBRL: round2(realBalance),
        nominalContributedBRL: round2(nominalContributed),
        realContributedBRL: round2(realContributed),
        nominalInterestBRL: round2(nominalInterest),
        realInterestBRL: round2(realInterest),
        annualContributionNominalBRL: round2(annualContribNominal),
        annualContributionRealBRL: round2(annualContribReal),
        monthlyPassiveIncomeRealBRL: round2(passiveReal),
      });

      annualContribNominal = 0;
      annualContribReal = 0;
    }
  }

  const finalCpiFactor = Math.pow(1 + monthlyInflationRate, totalMonths);
  const finalReal =
    finalCpiFactor > EPSILON ? nominalBalance / finalCpiFactor : nominalBalance;
  const totalInterestNominal = nominalBalance - nominalContributed;
  const totalInterestReal = finalReal - realContributed;

  const realGainPct =
    realContributed > EPSILON
      ? round2((totalInterestReal / realContributed) * 100)
      : 0;
  const nominalGainPct =
    nominalContributed > EPSILON
      ? round2((totalInterestNominal / nominalContributed) * 100)
      : 0;

  const estimatedMonthlyPassiveIncomeRealBRL =
    monthlyRealRate > 0 ? round2(finalReal * monthlyRealRate) : 0;
  const estimatedMonthlyPassiveIncomeNominalBRL =
    monthlyNominalRate > 0 ? round2(nominalBalance * monthlyNominalRate) : 0;

  const purchasingPowerLossPct =
    finalCpiFactor > EPSILON ? round2((1 - 1 / finalCpiFactor) * 100) : 0;

  return {
    points,
    yearlyRows,
    milestones,
    summary: {
      initialValueBRL: round2(initialValueBRL),
      horizonYears,
      finalNominalBRL: round2(nominalBalance),
      finalRealBRL: round2(finalReal),
      totalContributedNominalBRL: round2(nominalContributed),
      totalContributedRealBRL: round2(realContributed),
      totalInterestNominalBRL: round2(totalInterestNominal),
      totalInterestRealBRL: round2(totalInterestReal),
      realGainPct,
      nominalGainPct,
      realAnnualReturnPct: round2(realAnnualReturnPct),
      monthlyRealRatePct: round2(monthlyRealRate * 100),
      estimatedMonthlyPassiveIncomeRealBRL,
      estimatedMonthlyPassiveIncomeNominalBRL,
      purchasingPowerLossPct,
      finalCpiFactor,
      finalMonthlyContributionNominalBRL: round2(
        lastMonthlyContributionNominal
      ),
    },
  };
}
