"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  Coins,
  Flag,
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
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
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
    <div className="pointer-events-none hidden min-w-[195px] max-w-[250px] rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-xs sm:block dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-1.5 border-b border-slate-100 pb-1 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {pt.tooltipLabel}
      </div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Real
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(pt.realBalanceBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            Nominal
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {maskBRL(pt.nominalBalanceBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Aportado
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {maskBRL(
              isReal ? pt.realContributedBRL : pt.nominalContributedBRL,
              isPrivate
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-1 dark:border-slate-800">
          <span className="text-slate-600 dark:text-slate-400">Juros</span>
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
  const primary = isReal ? point.realBalanceBRL : point.nominalBalanceBRL;
  const secondary = isReal ? point.nominalBalanceBRL : point.realBalanceBRL;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] tabular-nums transition-colors",
        isPointActive
          ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/70 dark:bg-emerald-950/25"
          : "border-slate-200/80 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-800/40"
      )}
    >
      <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
        {point.tooltipLabel}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-semibold text-slate-900 dark:text-slate-100">
          {maskBRL(primary, isPrivate)}
        </span>
        <span className="text-slate-400 dark:text-slate-500">
          ({isReal ? "Nom." : "Real"} {maskBRL(secondary, isPrivate)})
        </span>
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

  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [includeReserve, setIncludeReserve] = useState(false);

  const baseline = useMemo(
    () =>
      extractProjectionBaseline(evolutionData.points, {
        includeReserve,
      }),
    [evolutionData.points, includeReserve]
  );

  // User-editable parameters (null means synced with live baseline)
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

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Collapsible Premises & Simulator Bar */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <button
            type="button"
            onClick={() => setSimulatorOpen((prev) => !prev)}
            aria-expanded={simulatorOpen}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="truncate font-mono text-xs font-semibold text-slate-700 tabular-nums dark:text-slate-200">
              {horizonYears}A · {maskBRL(parsedMonthlyContribution, isPrivate)}
              /mês · {formatPct(parsedAnnualReturn, 1)} a.a.
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            {isCustomized && (
              <button
                type="button"
                onClick={handleResetDefaults}
                title="Restaurar padrões"
                aria-label="Restaurar padrões"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setSimulatorOpen((prev) => !prev)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                simulatorOpen || isCustomized
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              <span>Simular</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  simulatorOpen && "rotate-180"
                )}
              />
            </button>
          </div>
        </div>

        {simulatorOpen && (
          <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setIncludeReserve((prev) => !prev)}
                  className={cn(
                    "mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                    includeReserve
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  <Shield className="h-3 w-3" />
                  {includeReserve ? "Com Reserva" : "+ Reserva"}
                </button>
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
                    onChange={(e) =>
                      setMonthlyContributionOverride(e.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
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
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                        )}
                      >
                        {win}M
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Annual Return */}
              <div>
                <label className="block">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Retorno (% a.a.)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={annualReturnInput}
                    onChange={(e) => setAnnualReturnOverride(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
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
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                        )}
                      >
                        Hist.
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() =>
                      setAnnualReturnOverride(
                        formatDecimalInput(benchmarks.cdi, 2)
                      )
                    }
                    className={cn(
                      "rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition",
                      Math.abs(parsedAnnualReturn - benchmarks.cdi) < 0.05
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
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
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
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
                    Inflação (% a.a.)
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={annualInflationInput}
                    onChange={(e) => setAnnualInflationOverride(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
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
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                    )}
                  >
                    IPCA
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
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                      )}
                    >
                      {rate === 0 ? "0%" : `${String(rate).replace(".", ",")}%`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Horizon + Inflation-Adjusted Toggle */}
            <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 lg:grid-cols-2 dark:border-slate-800">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Prazo: <strong className="font-mono text-slate-800 dark:text-slate-200">{horizonYears} {horizonYears === 1 ? "ano" : "anos"}</strong>
                  </span>
                  <div className="flex items-center gap-1">
                    {HORIZON_PRESETS.map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => setHorizonYears(yr)}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11px] font-semibold transition",
                          horizonYears === yr
                            ? "bg-emerald-600 text-white"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                        )}
                      >
                        {yr}A
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={1}
                  value={horizonYears}
                  onChange={(e) => setHorizonYears(Number(e.target.value))}
                  aria-label="Prazo em anos"
                  className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-emerald-600 dark:bg-slate-700"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50/80 px-3 py-2.5 text-xs dark:bg-slate-800/40">
                <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-700 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={adjustContributionForInflation}
                    onChange={(e) =>
                      setAdjustContributionForInflation(e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
                  />
                  Corrigir aporte pela inflação
                </label>

                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                    isRealReturnPositive
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                  )}
                >
                  Real {summary.realAnnualReturnPct >= 0 ? "+" : ""}
                  {formatPct(summary.realAnnualReturnPct, 1)} a.a.
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Compact 2x2 KPI Strip */}
      <CompactKpiStrip
        columns={4}
        items={[
          {
            id: "final-real",
            label: `Patrimônio (${horizonYears}A)`,
            value: maskBRL(summary.finalRealBRL, isPrivate),
            icon: (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            subtext: `Nom.: ${maskBRL(summary.finalNominalBRL, isPrivate)}`,
            highlighted: true,
          },
          {
            id: "contributed",
            label: "Aportado (Real)",
            value: maskBRL(summary.totalContributedRealBRL, isPrivate),
            icon: (
              <Wallet className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            ),
            subtext: `Nom.: ${maskBRL(summary.totalContributedNominalBRL, isPrivate)}`,
          },
          {
            id: "interest",
            label: "Juros (Real)",
            value: maskSignedBRL(summary.totalInterestRealBRL, isPrivate),
            icon: (
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            ),
            valueClassName:
              summary.totalInterestRealBRL >= 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            subtext: `${summary.realGainPct >= 0 ? "+" : ""}${formatPct(summary.realGainPct, 0)}`,
          },
          {
            id: "passive-income",
            label: "Renda Passiva",
            value: `${maskBRL(summary.estimatedMonthlyPassiveIncomeRealBRL, isPrivate)}/m`,
            icon: (
              <Coins className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            ),
            subtext: isRealReturnPositive
              ? `${formatPct(summary.monthlyRealRatePct, 2)}/mês real`
              : "Retorno real ≤ 0",
          },
        ]}
      />

      {/* Real Milestones Strip */}
      {projection.milestones.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <Flag className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {projection.milestones.map((m) => (
            <span
              key={m.targetBRL}
              className="inline-flex items-center gap-1 rounded-full bg-emerald-50/80 px-2 py-0.5 text-[11px] font-medium text-emerald-800 tabular-nums dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <strong>{m.label}</strong>
              <span className="opacity-75">· {m.calendarYear}</span>
            </span>
          ))}
        </div>
      )}

      {/* Projection Chart */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base dark:text-slate-100">
            Evolução Projetada
          </h2>

          <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setDisplayBasis("REAL")}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-1 transition",
                displayBasis === "REAL"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              Real
            </button>
            <button
              type="button"
              onClick={() => setDisplayBasis("NOMINAL")}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-1 transition",
                displayBasis === "NOMINAL"
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              Nominal
            </button>
          </div>
        </div>

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
          className="h-[260px] sm:h-[320px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartZoom.visibleData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              {...chartZoom.chartEventHandlers}
            >
              <defs>
                <linearGradient id="ltpRealGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
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
                name="Nominal"
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
                name="Real"
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
                  isRealPrimary ? "realContributedBRL" : "nominalContributedBRL"
                }
                name="Aportado"
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

        {/* Desktop-Only Legend */}
        <div className="mt-3 hidden flex-wrap items-center justify-center gap-5 text-xs text-slate-600 sm:flex dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Real
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            Nominal
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Aportado
          </span>
        </div>
      </section>
    </div>
  );
}
