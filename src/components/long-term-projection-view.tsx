"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Coins,
  Flag,
  Info,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatPct } from "@/lib/domain/types";
import type { EvolutionData } from "@/lib/domain/evolution";
import type { BenchmarkRates } from "@/lib/domain/fixed-income";
import {
  CONTRIBUTION_AVERAGE_WINDOWS,
  type ContributionAverageWindow,
  type LongTermProjectionPoint,
  computeLongTermProjection,
  extractProjectionBaseline,
} from "@/lib/domain/long-term-projection";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import {
  ZoomableChartContainer,
  useChartZoom,
} from "@/components/zoomable-chart";
import { MASKED_COMPACT, maskBRL, maskSignedBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

type DisplayBasis = "REAL" | "NOMINAL";

const HORIZON_PRESETS = [5, 10, 15, 20, 30];
const RETURN_PRESETS = [8, 10, 12];
const INFLATION_PRESETS = [4.5, 6, 0];
const DEFAULT_HORIZON_YEARS = 20;
const DEFAULT_CONTRIBUTION_WINDOW: ContributionAverageWindow = 6;

const getPointRangeLabel = (pt: LongTermProjectionPoint) => pt.tooltipLabel;

function formatCompactBRL(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}R$ ${(abs / 1_000_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 1,
    })}M`;
  }
  if (abs >= 1_000) {
    return `${sign}R$ ${(abs / 1_000).toLocaleString("pt-BR", {
      maximumFractionDigits: 0,
    })}k`;
  }
  return `${sign}R$ ${abs.toFixed(0)}`;
}

function formatDecimalInput(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace(".", ",");
}

function parseLocaleNumber(raw: string, fallback = 0): number {
  const cleaned = raw.trim().replace(/\s+/g, "");
  if (!cleaned) return fallback;
  // Support both "1.234,56" and "1234.56"
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface ProjectionChartTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: LongTermProjectionPoint }>;
  displayBasis: DisplayBasis;
  isPrivate: boolean;
}

function ProjectionChartTooltip({
  active,
  payload,
  displayBasis,
  isPrivate,
}: ProjectionChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const isReal = displayBasis === "REAL";
  const primaryInterest = isReal ? pt.realInterestBRL : pt.nominalInterestBRL;
  const isPositive = primaryInterest >= 0;

  return (
    <div className="pointer-events-none hidden min-w-[205px] max-w-[260px] rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-xs sm:block dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1 dark:border-slate-800">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {pt.tooltipLabel}
        </span>
      </div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Patrimônio real
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(pt.realBalanceBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Patrimônio nominal
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {maskBRL(pt.nominalBalanceBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            {isReal ? "Aportado (real)" : "Aportado (nominal)"}
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {maskBRL(
              isReal ? pt.realContributedBRL : pt.nominalContributedBRL,
              isPrivate
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1 dark:border-slate-800">
          <span className="text-slate-600 dark:text-slate-400">
            {isReal ? "Ganho real" : "Ganho nominal"}
          </span>
          <span
            className={cn(
              "font-semibold",
              isPositive
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {maskSignedBRL(primaryInterest, isPrivate)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface ProjectionMobileReadoutProps {
  point: LongTermProjectionPoint | null;
  isPointActive: boolean;
  displayBasis: DisplayBasis;
  isPrivate: boolean;
}

function ProjectionMobileReadout({
  point,
  isPointActive,
  displayBasis,
  isPrivate,
}: ProjectionMobileReadoutProps) {
  if (!point) return null;
  const isReal = displayBasis === "REAL";
  const interest = isReal ? point.realInterestBRL : point.nominalInterestBRL;
  const isPositive = interest >= 0;

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-[11px] tabular-nums transition-colors",
        isPointActive
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/70 dark:bg-emerald-950/25"
          : "border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40"
      )}
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-200/60 pb-1 dark:border-slate-700/60">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {point.tooltipLabel}
        </span>
        <span
          className={cn(
            "text-[10px] font-semibold",
            isPositive
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          )}
        >
          {maskSignedBRL(interest, isPrivate)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2 text-[10px]">
        <div>
          <span className="block text-slate-500 dark:text-slate-400">Real</span>
          <strong className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(point.realBalanceBRL, isPrivate)}
          </strong>
        </div>
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            Nominal
          </span>
          <strong className="font-semibold text-indigo-700 dark:text-indigo-300">
            {maskBRL(point.nominalBalanceBRL, isPrivate)}
          </strong>
        </div>
        <div>
          <span className="block text-slate-500 dark:text-slate-400">
            Aportado
          </span>
          <strong className="font-medium text-slate-700 dark:text-slate-300">
            {maskBRL(
              isReal ? point.realContributedBRL : point.nominalContributedBRL,
              isPrivate
            )}
          </strong>
        </div>
      </div>
    </div>
  );
}

interface LongTermProjectionViewProps {
  evolutionData: EvolutionData;
  benchmarks: BenchmarkRates;
}

export function LongTermProjectionView({
  evolutionData,
  benchmarks,
}: LongTermProjectionViewProps) {
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [includeReserve, setIncludeReserve] = useState(false);

  const baseline = useMemo(
    () =>
      extractProjectionBaseline(evolutionData.points, {
        includeReserve,
      }),
    [evolutionData.points, includeReserve]
  );

  // User-editable parameters (null means "synced with live baseline")
  const [contributionWindow, setContributionWindow] =
    useState<ContributionAverageWindow>(DEFAULT_CONTRIBUTION_WINDOW);
  const [initialValueOverride, setInitialValueOverride] = useState<
    string | null
  >(null);
  const [monthlyContributionOverride, setMonthlyContributionOverride] =
    useState<string | null>(null);
  const [annualReturnOverride, setAnnualReturnOverride] = useState<
    string | null
  >(null);
  const [annualInflationOverride, setAnnualInflationOverride] = useState<
    string | null
  >(null);
  const [horizonYears, setHorizonYears] = useState<number>(
    DEFAULT_HORIZON_YEARS
  );
  const [adjustContributionForInflation, setAdjustContributionForInflation] =
    useState<boolean>(true);
  const [displayBasis, setDisplayBasis] = useState<DisplayBasis>("REAL");
  const [showAllYears, setShowAllYears] = useState(false);

  const defaultInitialValueStr = formatDecimalInput(
    baseline.currentValueBRL,
    2
  );
  const defaultMonthlyContributionStr = formatDecimalInput(
    baseline.averageMonthlyContribution[contributionWindow],
    2
  );
  const defaultAnnualReturnStr = formatDecimalInput(
    baseline.defaultAnnualReturnPct,
    2
  );
  const defaultAnnualInflationStr = formatDecimalInput(benchmarks.ipca, 2);

  const initialValueInput = initialValueOverride ?? defaultInitialValueStr;
  const monthlyContributionInput =
    monthlyContributionOverride ?? defaultMonthlyContributionStr;
  const annualReturnInput = annualReturnOverride ?? defaultAnnualReturnStr;
  const annualInflationInput =
    annualInflationOverride ?? defaultAnnualInflationStr;

  const parsedInitialValue = Math.max(
    0,
    parseLocaleNumber(initialValueInput, baseline.currentValueBRL)
  );
  const parsedMonthlyContribution = Math.max(
    0,
    parseLocaleNumber(
      monthlyContributionInput,
      baseline.averageMonthlyContribution[contributionWindow]
    )
  );
  const parsedAnnualReturn = parseLocaleNumber(
    annualReturnInput,
    baseline.defaultAnnualReturnPct
  );
  const parsedAnnualInflation = parseLocaleNumber(
    annualInflationInput,
    benchmarks.ipca
  );

  const isCustomized =
    initialValueOverride !== null ||
    monthlyContributionOverride !== null ||
    annualReturnOverride !== null ||
    annualInflationOverride !== null ||
    horizonYears !== DEFAULT_HORIZON_YEARS ||
    !adjustContributionForInflation ||
    contributionWindow !== DEFAULT_CONTRIBUTION_WINDOW ||
    includeReserve;

  function handleResetDefaults() {
    setIncludeReserve(false);
    setContributionWindow(DEFAULT_CONTRIBUTION_WINDOW);
    setInitialValueOverride(null);
    setMonthlyContributionOverride(null);
    setAnnualReturnOverride(null);
    setAnnualInflationOverride(null);
    setHorizonYears(DEFAULT_HORIZON_YEARS);
    setAdjustContributionForInflation(true);
  }

  function handleSelectContributionWindow(win: ContributionAverageWindow) {
    setContributionWindow(win);
    setMonthlyContributionOverride(null);
  }

  const projection = useMemo(
    () =>
      computeLongTermProjection({
        initialValueBRL: parsedInitialValue,
        monthlyContributionBRL: parsedMonthlyContribution,
        annualReturnPct: parsedAnnualReturn,
        annualInflationPct: parsedAnnualInflation,
        horizonYears,
        adjustContributionForInflation,
        startDateISO: baseline.referenceDate ?? undefined,
      }),
    [
      parsedInitialValue,
      parsedMonthlyContribution,
      parsedAnnualReturn,
      parsedAnnualInflation,
      horizonYears,
      adjustContributionForInflation,
      baseline.referenceDate,
    ]
  );

  const chartZoom = useChartZoom(projection.points, {
    resetKey: `${horizonYears}|${displayBasis}`,
    minVisiblePoints: 3,
    plotLeftInset: 68,
    plotRightInset: 8,
    getRangeLabel: getPointRangeLabel,
  });

  const { summary } = projection;
  const isRealPrimary = displayBasis === "REAL";
  const isRealReturnPositive = summary.realAnnualReturnPct > 0;

  const chartGridColor = isDark ? "#1e293b" : "#f1f5f9";
  const chartTickColor = isDark ? "#94a3b8" : "#64748b";

  const visibleTableRows = useMemo(() => {
    if (showAllYears || projection.yearlyRows.length <= 10) {
      return projection.yearlyRows;
    }
    // Show years 1..5, then multiples of 5, plus final year
    return projection.yearlyRows.filter(
      (r) =>
        r.year <= 5 ||
        r.year % 5 === 0 ||
        r.year === projection.yearlyRows.length
    );
  }, [projection.yearlyRows, showAllYears]);

  const monthsUsed = baseline.monthsUsedByWindow[contributionWindow];

  return (
    <div className="space-y-6">
      {/* Premises & Simulator Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Premissas da Projeção
            </h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                isCustomized
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              )}
            >
              {isCustomized ? "Cenário simulado" : "Base da sua carteira"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIncludeReserve((prev) => !prev)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                includeReserve
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              <Shield className="h-3.5 w-3.5" />
              {includeReserve ? "Com Reserva" : "Incluir Reserva"}
            </button>

            {isCustomized && (
              <button
                type="button"
                onClick={handleResetDefaults}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar padrões
              </button>
            )}
          </div>
        </div>

        {/* Inputs Grid */}
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Initial Capital */}
          <div>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Patrimônio inicial (R$)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={initialValueInput}
                onChange={(e) => setInitialValueOverride(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              {includeReserve
                ? `Investido + Reserva (${maskBRL(baseline.reserveValueBRL, isPrivate)})`
                : `Total investido atual (sem Reserva)`}
            </p>
          </div>

          {/* Monthly Contribution */}
          <div>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Aporte mensal (R$)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={monthlyContributionInput}
                onChange={(e) => setMonthlyContributionOverride(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {CONTRIBUTION_AVERAGE_WINDOWS.map((win) => {
                const isActive =
                  monthlyContributionOverride === null &&
                  contributionWindow === win;
                return (
                  <button
                    key={win}
                    type="button"
                    onClick={() => handleSelectContributionWindow(win)}
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                      isActive
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    )}
                    title={`Média dos últimos ${win} meses fechados: ${maskBRL(baseline.averageMonthlyContribution[win], isPrivate)}`}
                  >
                    Média {win}M
                  </button>
                );
              })}
              {monthsUsed > 0 && monthlyContributionOverride === null && (
                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                  ({monthsUsed}m)
                </span>
              )}
            </div>
          </div>

          {/* Annual Return */}
          <div>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Rendimento anual (% a.a.)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={annualReturnInput}
                onChange={(e) => setAnnualReturnOverride(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {baseline.historicalAnnualReturnPct !== null &&
                baseline.historicalAnnualReturnPct > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setAnnualReturnOverride(
                        formatDecimalInput(
                          baseline.historicalAnnualReturnPct!,
                          2
                        )
                      )
                    }
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                      Math.abs(
                        parsedAnnualReturn -
                          baseline.historicalAnnualReturnPct
                      ) < 0.05
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                    )}
                    title={`Histórico anualizado da carteira (${baseline.historicalDays} dias)`}
                  >
                    Hist. ({formatPct(baseline.historicalAnnualReturnPct, 1)})
                  </button>
                )}
              <button
                type="button"
                onClick={() =>
                  setAnnualReturnOverride(formatDecimalInput(benchmarks.cdi, 2))
                }
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                  Math.abs(parsedAnnualReturn - benchmarks.cdi) < 0.05
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                )}
              >
                CDI
              </button>
              {RETURN_PRESETS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() =>
                    setAnnualReturnOverride(formatDecimalInput(rate, 2))
                  }
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                    Math.abs(parsedAnnualReturn - rate) < 0.05
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  )}
                >
                  {rate}%
                </button>
              ))}
            </div>
          </div>

          {/* Expected Inflation */}
          <div>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Inflação prevista (% a.a.)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={annualInflationInput}
                onChange={(e) => setAnnualInflationOverride(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => setAnnualInflationOverride(null)}
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                  annualInflationOverride === null
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                )}
              >
                IPCA ({formatPct(benchmarks.ipca, 1)})
              </button>
              {INFLATION_PRESETS.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() =>
                    setAnnualInflationOverride(formatDecimalInput(rate, 2))
                  }
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                    annualInflationOverride !== null &&
                      Math.abs(parsedAnnualInflation - rate) < 0.05
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                  )}
                >
                  {rate === 0 ? "0%" : `${String(rate).replace(".", ",")}%`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Horizon Slider + Inflation-Adjusted Contributions Toggle */}
        <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2 dark:border-slate-800">
          {/* Horizon */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Prazo da projeção
              </span>
              <div className="flex items-center gap-1.5">
                {HORIZON_PRESETS.map((yr) => (
                  <button
                    key={yr}
                    type="button"
                    onClick={() => setHorizonYears(yr)}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-semibold transition",
                      horizonYears === yr
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    )}
                  >
                    {yr}A
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={50}
                step={1}
                value={horizonYears}
                onChange={(e) => setHorizonYears(Number(e.target.value))}
                aria-label="Prazo em anos"
                className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-600 dark:bg-slate-700"
              />
              <span className="min-w-[74px] rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-center text-xs font-bold tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                {horizonYears} {horizonYears === 1 ? "ano" : "anos"}
              </span>
            </div>
          </div>

          {/* Inflation adjustment toggle + Fisher real rate pill */}
          <div className="flex flex-col justify-between gap-2.5 rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/40">
            <label className="flex cursor-pointer items-start justify-between gap-3">
              <div>
                <span className="block text-xs font-semibold text-slate-800 dark:text-slate-100">
                  Corrigir aportes mensais pela inflação
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                  {adjustContributionForInflation
                    ? `Mantém o poder de compra do aporte mensal (chega a ${maskBRL(summary.finalMonthlyContributionNominalBRL, isPrivate)} nominais no ano ${horizonYears}).`
                    : "Aporte permanece nominalmente fixo e perde poder de compra ao longo do tempo."}
                </span>
              </div>
              <input
                type="checkbox"
                checked={adjustContributionForInflation}
                onChange={(e) =>
                  setAdjustContributionForInflation(e.target.checked)
                }
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 accent-emerald-600"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-[11px] dark:border-slate-700/70">
              <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <Info className="h-3.5 w-3.5" />
                Taxa real efetiva (acima da inflação):
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-semibold tabular-nums",
                  isRealReturnPositive
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                )}
              >
                {summary.realAnnualReturnPct >= 0 ? "+" : ""}
                {formatPct(summary.realAnnualReturnPct, 2)} a.a.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Patrimônio em {horizonYears}{" "}
              {horizonYears === 1 ? "ano" : "anos"} (Real)
            </span>
            <span className="rounded-lg bg-emerald-50 p-1.5 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {maskBRL(summary.finalRealBRL, isPrivate)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            Valor nominal futuro:{" "}
            <strong className="font-semibold text-indigo-700 dark:text-indigo-300">
              {maskBRL(summary.finalNominalBRL, isPrivate)}
            </strong>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total aportado (Real)
            </span>
            <span className="rounded-lg bg-slate-100 p-1.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <Wallet className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {maskBRL(summary.totalContributedRealBRL, isPrivate)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            Nominal acumulado:{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-300">
              {maskBRL(summary.totalContributedNominalBRL, isPrivate)}
            </strong>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Juros compostos (Ganho real)
            </span>
            <span className="rounded-lg bg-indigo-50 p-1.5 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </span>
          </div>
          <p
            className={cn(
              "mt-2 text-xl font-bold tracking-tight tabular-nums",
              summary.totalInterestRealBRL >= 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {maskSignedBRL(summary.totalInterestRealBRL, isPrivate)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
            {summary.realGainPct >= 0 ? "+" : ""}
            {formatPct(summary.realGainPct, 1)} sobre aportado · Nominal:{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-300">
              {maskSignedBRL(summary.totalInterestNominalBRL, isPrivate)}
            </strong>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Renda passiva mensal (Real)
            </span>
            <span className="rounded-lg bg-amber-50 p-1.5 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
              <Coins className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {maskBRL(summary.estimatedMonthlyPassiveIncomeRealBRL, isPrivate)}
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              /mês
            </span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {isRealReturnPositive
              ? `Rendimento real mensal (${formatPct(summary.monthlyRealRatePct, 2)}/mês) preservando o principal`
              : "Inflação igual ou superior ao rendimento anual"}
          </p>
        </div>
      </div>

      {/* Real Milestones Strip */}
      {projection.milestones.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
            <Flag className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Marcos reais:
          </span>
          {projection.milestones.map((m) => (
            <span
              key={m.targetBRL}
              className="inline-flex items-center gap-1 rounded-full border border-emerald-200/80 bg-emerald-50/70 px-2.5 py-0.5 text-[11px] font-medium text-emerald-800 tabular-nums dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <strong>{m.label}</strong>
              <span className="text-emerald-700/80 dark:text-emerald-400/80">
                · Ano {m.year} ({m.calendarYear})
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Projection Chart */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Evolução Projetada do Patrimônio
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {isRealPrimary
                ? "Destaque para o poder de compra em reais de hoje, comparado ao valor nominal futuro."
                : "Destaque para o valor nominal futuro, comparado ao poder de compra em reais de hoje."}
            </p>
          </div>

          <div className="inline-flex self-start rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-800 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setDisplayBasis("REAL")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                displayBasis === "REAL"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              Poder de compra (Real)
            </button>
            <button
              type="button"
              onClick={() => setDisplayBasis("NOMINAL")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition",
                displayBasis === "NOMINAL"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              Valor futuro (Nominal)
            </button>
          </div>
        </div>

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Patrimônio real (hoje)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            Patrimônio nominal (futuro)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            {isRealPrimary ? "Total aportado (real)" : "Total aportado (nominal)"}
          </span>
        </div>

        {/* Area Chart */}
        <div className="mt-3">
          <ZoomableChartContainer
            containerRef={chartZoom.containerRef}
            isZoomed={chartZoom.isZoomed}
            isInteracting={chartZoom.isInteracting}
            rangeLabel={chartZoom.rangeLabel}
            onResetZoom={chartZoom.resetZoom}
            mobileReadout={
              <ProjectionMobileReadout
                point={chartZoom.displayPoint}
                isPointActive={chartZoom.isPointActive}
                displayBasis={displayBasis}
                isPrivate={isPrivate}
              />
            }
            className="h-[280px] sm:h-[340px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartZoom.visibleData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                {...chartZoom.chartEventHandlers}
              >
                <defs>
                  <linearGradient
                    id="ltpRealGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                    <stop
                      offset="95%"
                      stopColor="#10b981"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                  <linearGradient
                    id="ltpNominalGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={chartGridColor}
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: chartTickColor }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={28}
                />
                <YAxis
                  domain={chartZoom.isZoomed ? ["auto", "auto"] : undefined}
                  tickFormatter={(v: number) =>
                    isPrivate ? MASKED_COMPACT : formatCompactBRL(v)
                  }
                  tick={{ fontSize: 11, fill: chartTickColor }}
                  tickLine={false}
                  axisLine={false}
                  width={68}
                />
                <Tooltip
                  offset={28}
                  position={{ y: 4 }}
                  wrapperStyle={{
                    pointerEvents: "none",
                    ...(chartZoom.isInteracting ? { display: "none" } : {}),
                  }}
                  content={
                    <ProjectionChartTooltip
                      displayBasis={displayBasis}
                      isPrivate={isPrivate}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="nominalBalanceBRL"
                  name="Patrimônio nominal"
                  stroke="#6366f1"
                  strokeWidth={isRealPrimary ? 1.75 : 2.25}
                  strokeDasharray={isRealPrimary ? "4 4" : undefined}
                  fill="url(#ltpNominalGrad)"
                  isAnimationActive={
                    !chartZoom.isInteracting && !chartZoom.isZoomed
                  }
                />
                <Area
                  type="monotone"
                  dataKey="realBalanceBRL"
                  name="Patrimônio real"
                  stroke="#10b981"
                  strokeWidth={isRealPrimary ? 2.25 : 1.75}
                  strokeDasharray={isRealPrimary ? undefined : "4 4"}
                  fill="url(#ltpRealGrad)"
                  isAnimationActive={
                    !chartZoom.isInteracting && !chartZoom.isZoomed
                  }
                />
                <Area
                  type="monotone"
                  dataKey={
                    isRealPrimary
                      ? "realContributedBRL"
                      : "nominalContributedBRL"
                  }
                  name="Total aportado"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  fill="none"
                  isAnimationActive={
                    !chartZoom.isInteracting && !chartZoom.isZoomed
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </ZoomableChartContainer>
        </div>

        {parsedAnnualInflation > 0 && (
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            Com inflação de{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-300">
              {formatPct(parsedAnnualInflation, 2)} a.a.
            </strong>
            , R$ 1,00 daqui a {horizonYears}{" "}
            {horizonYears === 1 ? "ano" : "anos"} terá o poder de compra de{" "}
            <strong className="font-semibold text-slate-700 dark:text-slate-300">
              R$ {(1 / summary.finalCpiFactor).toFixed(2).replace(".", ",")}
            </strong>{" "}
            hoje (perda acumulada de{" "}
            {formatPct(summary.purchasingPowerLossPct, 1)}).
          </p>
        )}
      </section>

      {/* Year-by-year Breakdown Table */}
      <section className="rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 sm:px-5 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Detalhamento Ano a Ano
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Evolução do patrimônio em poder de compra de hoje (real) e valor
              nominal futuro.
            </p>
          </div>
          {projection.yearlyRows.length > 10 && (
            <button
              type="button"
              onClick={() => setShowAllYears((prev) => !prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {showAllYears ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  Resumir anos
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" />
                  Ver todos os {projection.yearlyRows.length} anos
                </>
              )}
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="px-4 py-2.5 sm:px-5">Ano</th>
                <th className="px-3 py-2.5 text-right">Patrimônio Real</th>
                <th className="px-3 py-2.5 text-right">Patrimônio Nominal</th>
                <th className="px-3 py-2.5 text-right">Aportado (Real)</th>
                <th className="px-3 py-2.5 text-right">Ganho Real</th>
                <th className="px-4 py-2.5 text-right sm:px-5">
                  Renda Passiva / mês
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/80">
              {visibleTableRows.map((row) => {
                const isFinal = row.year === projection.yearlyRows.length;
                return (
                  <tr
                    key={row.year}
                    className={cn(
                      "transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40",
                      isFinal &&
                        "bg-emerald-50/40 font-semibold dark:bg-emerald-950/20"
                    )}
                  >
                    <td className="px-4 py-2.5 font-medium text-slate-800 sm:px-5 dark:text-slate-200">
                      Ano {row.year}{" "}
                      <span className="text-slate-400 dark:text-slate-500">
                        ({row.calendarYear})
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                      {maskBRL(row.realBalanceBRL, isPrivate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-indigo-700 dark:text-indigo-300">
                      {maskBRL(row.nominalBalanceBRL, isPrivate)}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400">
                      {maskBRL(row.realContributedBRL, isPrivate)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-medium",
                        row.realInterestBRL >= 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {maskSignedBRL(row.realInterestBRL, isPrivate)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-700 sm:px-5 dark:text-slate-300">
                      {maskBRL(row.monthlyPassiveIncomeRealBRL, isPrivate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
