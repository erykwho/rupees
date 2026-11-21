"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  Calendar,
  Coins,
  Layers,
  Plus,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ALL_ASSET_CLASSES,
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  type AssetClassKey,
  INVESTMENT_CLASSES,
  formatBRL,
  formatPct,
} from "@/lib/domain/types";
import {
  type AggregatedContributionPoint,
  type AggregatedEvolutionPoint,
  type EvolutionChartMode,
  type EvolutionData,
  type EvolutionGranularity,
  type EvolutionRange,
  aggregateEvolutionView,
  formatDateFullPTBR,
} from "@/lib/domain/evolution";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import { MASKED_COMPACT, maskBRL, maskSignedBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS: Array<{ value: EvolutionRange; label: string }> = [
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
  { value: "6M", label: "6M" },
  { value: "YTD", label: "YTD" },
  { value: "1A", label: "1A" },
  { value: "2A", label: "2A" },
  { value: "5A", label: "5A" },
  { value: "ALL", label: "Tudo" },
];

const CHART_MODES: Array<{ value: EvolutionChartMode; label: string }> = [
  { value: "PATRIMONIO", label: "Patrimônio vs. Aportado" },
  { value: "GANHO", label: "Ganho (R$)" },
  { value: "RENTABILIDADE", label: "Rentabilidade (%)" },
];

function formatCompactBRL(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
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

interface EvolutionTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: AggregatedEvolutionPoint }>;
  splitByClass?: boolean;
  activeClasses?: AssetClassKey[];
  chartMode?: EvolutionChartMode;
  isPrivate?: boolean;
}

function EvolutionTooltip({
  active,
  payload,
  splitByClass = false,
  activeClasses = [],
  chartMode = "PATRIMONIO",
  isPrivate = false,
}: EvolutionTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  const isPositive = pt.profitLossBRL >= 0;

  return (
    <div className="min-w-[220px] rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-2 border-b border-slate-100 pb-1.5 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {pt.tooltipLabel}
      </p>
      <div className="space-y-1.5 tabular-nums">
        {splitByClass && activeClasses.length > 1 && (
          <div className="space-y-1 border-b border-slate-100 pb-1.5 dark:border-slate-800">
            {activeClasses.map((cls) => {
              const value =
                chartMode === "PATRIMONIO"
                  ? pt.classMarketValue[cls]
                  : chartMode === "GANHO"
                    ? pt.classProfitLoss[cls]
                    : pt.classProfitLossPct[cls];
              const isPos = value >= 0;
              return (
                <div
                  key={cls}
                  className="flex items-center justify-between gap-4"
                >
                  <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                    />
                    {ASSET_CLASS_LABELS[cls]}
                  </span>
                  <span
                    className={cn(
                      "font-medium",
                      chartMode === "PATRIMONIO"
                        ? "text-slate-900 dark:text-slate-100"
                        : isPos
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {chartMode === "RENTABILIDADE"
                      ? `${isPos ? "+" : ""}${formatPct(value, 1)}`
                      : chartMode === "GANHO"
                        ? maskSignedBRL(value, isPrivate)
                        : maskBRL(value, isPrivate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
            {splitByClass ? "Total Patrimônio" : "Patrimônio"}
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(pt.marketValueBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            {splitByClass ? "Total Aportado" : "Aportado"}
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {maskBRL(pt.investedCostBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-1.5 dark:border-slate-800">
          <span className="text-slate-600 dark:text-slate-400">Rendimento</span>
          <span
            className={cn(
              "font-semibold",
              isPositive
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {maskSignedBRL(pt.profitLossBRL, isPrivate)} ({isPositive ? "+" : ""}
            {formatPct(pt.profitLossPct, 1)})
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-[11px] text-slate-400 dark:text-slate-500">
          <span>Dólar (USDBRL)</span>
          <span>{formatBRL(pt.usdBrl)}</span>
        </div>
      </div>
    </div>
  );
}

interface ContributionTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: AggregatedContributionPoint }>;
  activeClasses: AssetClassKey[];
  isPrivate?: boolean;
}

function ContributionTooltip({
  active,
  payload,
  activeClasses,
  isPrivate = false,
}: ContributionTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  const nonZeroClasses = activeClasses.filter(
    (cls) => Math.abs(row[cls]) > 0.005
  );

  return (
    <div className="min-w-[200px] rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-2 border-b border-slate-100 pb-1.5 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {row.tooltipLabel}
      </p>
      <div className="space-y-1 tabular-nums">
        {nonZeroClasses.length === 0 ? (
          <p className="text-slate-400 dark:text-slate-500">
            Sem movimentação no período
          </p>
        ) : (
          nonZeroClasses.map((cls) => {
            const val = row[cls];
            return (
              <div
                key={cls}
                className="flex items-center justify-between gap-4"
              >
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                  />
                  {ASSET_CLASS_LABELS[cls]}
                </span>
                <span
                  className={cn(
                    "font-medium",
                    val >= 0
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-rose-600 dark:text-rose-400"
                  )}
                >
                  {maskSignedBRL(val, isPrivate)}
                </span>
              </div>
            );
          })
        )}
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-1.5 font-semibold dark:border-slate-800">
          <span className="text-slate-700 dark:text-slate-300">
            Total líquido
          </span>
          <span
            className={cn(
              row.totalBRL >= 0
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {maskSignedBRL(row.totalBRL, isPrivate)}
          </span>
        </div>
      </div>
    </div>
  );
}

interface EvolutionViewProps {
  initialData: EvolutionData;
}

export function EvolutionView({ initialData }: EvolutionViewProps) {
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [data, setData] = useState<EvolutionData>(initialData);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [selectedClasses, setSelectedClasses] = useState<AssetClassKey[]>([]);
  const [includeReserve, setIncludeReserve] = useState(false);
  const [range, setRange] = useState<EvolutionRange>("ALL");
  const [granularity, setGranularity] = useState<EvolutionGranularity>("DAILY");
  const [chartMode, setChartMode] = useState<EvolutionChartMode>("PATRIMONIO");
  const [splitByClass, setSplitByClass] = useState(false);
  const [contributionGrouping, setContributionGrouping] =
    useState<EvolutionGranularity>("MONTHLY");

  const eligibleClasses: AssetClassKey[] = includeReserve
    ? ALL_ASSET_CLASSES
    : INVESTMENT_CLASSES;

  const isTotalSelected = selectedClasses.length === 0;

  function toggleClass(cls: AssetClassKey) {
    setSelectedClasses((prev) => {
      const exists = prev.includes(cls);
      const next = exists ? prev.filter((c) => c !== cls) : [...prev, cls];
      if (next.length >= eligibleClasses.length) {
        return [];
      }
      return next;
    });
  }

  function handleToggleReserve() {
    setIncludeReserve((prev) => {
      const next = !prev;
      if (!next) {
        setSelectedClasses((curr) =>
          curr.filter((c) => c !== "EMERGENCY_RESERVE")
        );
      }
      return next;
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/evolution?refresh=1");
      if (res.ok) {
        const json = await res.json();
        if (json.evolution) {
          setData(json.evolution);
        }
      }
    } finally {
      setRefreshing(false);
    }
  }

  const aggregated = useMemo(
    () =>
      aggregateEvolutionView(data.points, {
        selectedClasses,
        includeReserve,
        range,
        granularity,
        contributionGrouping,
      }),
    [
      data.points,
      selectedClasses,
      includeReserve,
      range,
      granularity,
      contributionGrouping,
    ]
  );

  const { kpis, evolutionSeries, contributionSeries, activeClasses } =
    aggregated;

  const selectionDescription = useMemo(() => {
    if (isTotalSelected) {
      return includeReserve ? "Total investido + Reserva" : "Total investido";
    }
    return activeClasses.map((c) => ASSET_CLASS_LABELS[c]).join(" + ");
  }, [isTotalSelected, includeReserve, activeClasses]);

  const gainValue = kpis.isSubPeriod
    ? kpis.periodGainBRL
    : kpis.totalProfitLossBRL;
  const isGainPositive = gainValue >= 0;
  const isTotalReturnPositive = kpis.totalProfitLossPct >= 0;

  const gridStroke = isDark ? "#1e293b" : "#e2e8f0";
  const axisTickFill = isDark ? "#94a3b8" : "#64748b";
  const refLineStroke = isDark ? "#475569" : "#94a3b8";

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Evolução Patrimonial
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {data.firstTransactionDate ? (
              <>
                Histórico diário desde{" "}
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {formatDateFullPTBR(data.firstTransactionDate)}
                </span>{" "}
                · Dólar:{" "}
                <span className="font-mono font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                  {formatBRL(data.usdBrl)}
                </span>
              </>
            ) : (
              "Acompanhe a evolução do seu patrimônio, rendimentos e aportes ao longo do tempo."
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing ? "Atualizando..." : "Atualizar dados"}
          </button>

          <Link
            href="/lancamentos?novo=1"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Novo lançamento
          </Link>
        </div>
      </div>

      {/* Empty State */}
      {data.points.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <TrendingUp className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
            Sem histórico de lançamentos
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            Registre seus aportes na tela de Lançamentos para visualizar a
            evolução diária e mensal do patrimônio e rendimentos.
          </p>
          <Link
            href="/lancamentos?novo=1"
            className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Registrar primeiro lançamento
          </Link>
        </div>
      ) : (
        <>
          {/* Filter Bar */}
          <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            {/* Row 1: Asset Class Multi-Select Chips + Reserve Toggle */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedClasses([])}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                    isTotalSelected
                      ? "bg-slate-900 text-white shadow-2xs dark:bg-slate-100 dark:text-slate-900"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                  )}
                >
                  Total
                </button>

                {eligibleClasses.map((cls) => {
                  const active = selectedClasses.includes(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => toggleClass(cls)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                        active
                          ? "border-slate-900 bg-slate-900 text-white shadow-2xs dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                      />
                      {ASSET_CLASS_LABELS[cls]}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleToggleReserve}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  includeReserve
                    ? "border-slate-700 bg-slate-100 text-slate-900 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                )}
              >
                <Shield
                  className={cn(
                    "h-3.5 w-3.5",
                    includeReserve
                      ? "text-slate-700 dark:text-slate-200"
                      : "text-slate-400 dark:text-slate-500"
                  )}
                />
                {includeReserve ? "Reserva incluída" : "Incluir Reserva"}
              </button>
            </div>

            {/* Row 2: Period Range + Daily/Monthly Granularity */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />
                  Período:
                </span>
                {RANGE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRange(opt.value)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      range === opt.value
                        ? "bg-emerald-600 text-white shadow-2xs"
                        : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setGranularity("DAILY")}
                  className={cn(
                    "rounded-lg px-3 py-1 transition-colors",
                    granularity === "DAILY"
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Diária
                </button>
                <button
                  type="button"
                  onClick={() => setGranularity("MONTHLY")}
                  className={cn(
                    "rounded-lg px-3 py-1 transition-colors",
                    granularity === "MONTHLY"
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Mensal
                </button>
              </div>
            </div>
          </div>

          {/* KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {/* Patrimônio */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Patrimônio Atual</span>
                <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
                {maskBRL(kpis.currentMarketValueBRL, isPrivate)}
              </p>
              <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                {selectionDescription}
              </p>
            </div>

            {/* Aportado */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>
                  {kpis.isSubPeriod ? "Aportado no Período" : "Custo Aportado"}
                </span>
                <Coins className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              </div>
              <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
                {maskBRL(
                  kpis.isSubPeriod
                    ? kpis.periodContributionBRL
                    : kpis.totalInvestedCostBRL,
                  isPrivate
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {kpis.isSubPeriod
                  ? `Custo acumulado: ${maskBRL(kpis.totalInvestedCostBRL, isPrivate)}`
                  : `Aporte líquido: ${maskBRL(kpis.periodContributionBRL, isPrivate)}`}
              </p>
            </div>

            {/* Rendimento R$ */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>
                  {kpis.isSubPeriod
                    ? "Rendimento no Período"
                    : "Rendimento Acumulado"}
                </span>
                {isGainPositive ? (
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                )}
              </div>
              <p
                className={cn(
                  "mt-2 text-2xl font-bold tracking-tight tabular-nums",
                  isGainPositive
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {maskSignedBRL(gainValue, isPrivate)}
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {kpis.isSubPeriod
                  ? `Acumulado total: ${maskSignedBRL(kpis.totalProfitLossBRL, isPrivate)}`
                  : "Patrimônio menos custo aportado"}
              </p>
            </div>

            {/* Rentabilidade % */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                <span>Rentabilidade Acumulada</span>
                {isTotalReturnPositive ? (
                  <ArrowUpRight className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <ArrowDownRight className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                )}
              </div>
              <p
                className={cn(
                  "mt-2 text-2xl font-bold tracking-tight tabular-nums",
                  isTotalReturnPositive
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {isTotalReturnPositive ? "+" : ""}
                {formatPct(kpis.totalProfitLossPct, 2)}
              </p>
              <p className="mt-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {kpis.isSubPeriod
                  ? `No período: ${
                      kpis.periodReturnPct >= 0 ? "+" : ""
                    }${formatPct(kpis.periodReturnPct, 2)}`
                  : "Sobre o custo total aportado"}
              </p>
            </div>
          </div>

          {/* Chart 1: Patrimônio vs Aportado / Ganho / Rentabilidade */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {chartMode === "PATRIMONIO" &&
                    (splitByClass && activeClasses.length > 1
                      ? "Patrimônio por Classe"
                      : "Patrimônio vs. Aportado")}
                  {chartMode === "GANHO" &&
                    (splitByClass && activeClasses.length > 1
                      ? "Rendimento por Classe (R$)"
                      : "Evolução do Rendimento (R$)")}
                  {chartMode === "RENTABILIDADE" &&
                    (splitByClass && activeClasses.length > 1
                      ? "Rentabilidade por Classe (%)"
                      : "Rentabilidade Acumulada (%)")}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Visão {granularity === "DAILY" ? "diária" : "mensal"} ·{" "}
                  {selectionDescription}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSplitByClass((prev) => !prev)}
                  disabled={activeClasses.length <= 1}
                  title={
                    activeClasses.length <= 1
                      ? "Selecione mais de uma classe (ou Total) para comparar linhas por classe"
                      : "Alternar entre visão consolidada e uma linha por classe de ativo"
                  }
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                    splitByClass && activeClasses.length > 1
                      ? "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Por classe
                </button>

                <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
                  {CHART_MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setChartMode(m.value)}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 transition-colors",
                        chartMode === m.value
                          ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {evolutionSeries.length === 0 ? (
              <div className="flex h-72 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                Sem dados para o filtro selecionado.
              </div>
            ) : (
              <>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={evolutionSeries}
                      margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                    >
                      <defs>
                        <linearGradient
                          id="evoEmeraldGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#059669"
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="100%"
                            stopColor="#059669"
                            stopOpacity={0.01}
                          />
                        </linearGradient>
                        <linearGradient
                          id="evoRoseGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#e11d48"
                            stopOpacity={0.2}
                          />
                          <stop
                            offset="100%"
                            stopColor="#e11d48"
                            stopOpacity={0.01}
                          />
                        </linearGradient>
                        <linearGradient
                          id="evoBlueGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#0284c7"
                            stopOpacity={0.22}
                          />
                          <stop
                            offset="100%"
                            stopColor="#0284c7"
                            stopOpacity={0.01}
                          />
                        </linearGradient>
                      </defs>

                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: axisTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        minTickGap={28}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: axisTickFill }}
                        tickLine={false}
                        axisLine={false}
                        width={68}
                        tickFormatter={(val: number) =>
                          chartMode === "RENTABILIDADE"
                            ? `${val.toFixed(0)}%`
                            : isPrivate
                              ? MASKED_COMPACT
                              : formatCompactBRL(val)
                        }
                      />
                      <Tooltip
                        content={
                          <EvolutionTooltip
                            splitByClass={splitByClass && activeClasses.length > 1}
                            activeClasses={activeClasses}
                            chartMode={chartMode}
                            isPrivate={isPrivate}
                          />
                        }
                      />

                      {splitByClass && activeClasses.length > 1 ? (
                        <>
                          {chartMode !== "PATRIMONIO" && (
                            <ReferenceLine
                              y={0}
                              stroke={refLineStroke}
                              strokeDasharray="3 3"
                            />
                          )}
                          {activeClasses.map((cls) => (
                            <Area
                              key={cls}
                              type="monotone"
                              dataKey={(d: AggregatedEvolutionPoint) =>
                                chartMode === "PATRIMONIO"
                                  ? d.classMarketValue[cls]
                                  : chartMode === "GANHO"
                                    ? d.classProfitLoss[cls]
                                    : d.classProfitLossPct[cls]
                              }
                              name={ASSET_CLASS_LABELS[cls]}
                              stroke={ASSET_CLASS_COLORS[cls]}
                              strokeWidth={2}
                              fill="none"
                              dot={false}
                              activeDot={{
                                r: 4,
                                strokeWidth: 0,
                                fill: ASSET_CLASS_COLORS[cls],
                              }}
                            />
                          ))}
                        </>
                      ) : (
                        <>
                          {chartMode === "PATRIMONIO" && (
                            <>
                              <Area
                                type="monotone"
                                dataKey="marketValueBRL"
                                name="Patrimônio"
                                stroke="#10b981"
                                strokeWidth={2.2}
                                fill="url(#evoEmeraldGrad)"
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  strokeWidth: 0,
                                  fill: "#10b981",
                                }}
                              />
                              <Area
                                type="monotone"
                                dataKey="investedCostBRL"
                                name="Aportado"
                                stroke={isDark ? "#94a3b8" : "#64748b"}
                                strokeWidth={1.8}
                                strokeDasharray="5 4"
                                fill="none"
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  strokeWidth: 0,
                                  fill: isDark ? "#94a3b8" : "#64748b",
                                }}
                              />
                            </>
                          )}

                          {chartMode === "GANHO" && (
                            <>
                              <ReferenceLine
                                y={0}
                                stroke={refLineStroke}
                                strokeDasharray="3 3"
                              />
                              <Area
                                type="monotone"
                                dataKey="profitLossBRL"
                                name="Rendimento (R$)"
                                stroke={
                                  kpis.totalProfitLossBRL >= 0
                                    ? "#10b981"
                                    : "#f43f5e"
                                }
                                strokeWidth={2.2}
                                fill={
                                  kpis.totalProfitLossBRL >= 0
                                    ? "url(#evoEmeraldGrad)"
                                    : "url(#evoRoseGrad)"
                                }
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  strokeWidth: 0,
                                  fill:
                                    kpis.totalProfitLossBRL >= 0
                                      ? "#10b981"
                                      : "#f43f5e",
                                }}
                              />
                            </>
                          )}

                          {chartMode === "RENTABILIDADE" && (
                            <>
                              <ReferenceLine
                                y={0}
                                stroke={refLineStroke}
                                strokeDasharray="3 3"
                              />
                              <Area
                                type="monotone"
                                dataKey="profitLossPct"
                                name="Rentabilidade (%)"
                                stroke="#0ea5e9"
                                strokeWidth={2.2}
                                fill="url(#evoBlueGrad)"
                                dot={false}
                                activeDot={{
                                  r: 4,
                                  strokeWidth: 0,
                                  fill: "#0ea5e9",
                                }}
                              />
                            </>
                          )}
                        </>
                      )}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {splitByClass && activeClasses.length > 1 ? (
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                    {activeClasses.map((cls) => (
                      <span
                        key={cls}
                        className="inline-flex items-center gap-1.5"
                      >
                        <span
                          className="h-0.5 w-4 rounded-full"
                          style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                        />
                        {ASSET_CLASS_LABELS[cls]}
                      </span>
                    ))}
                  </div>
                ) : (
                  chartMode === "PATRIMONIO" && (
                    <div className="mt-3 flex flex-wrap items-center justify-center gap-5 text-xs text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-0.5 w-4 rounded-full bg-emerald-500" />
                        Patrimônio (valor de mercado)
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span className="h-0.5 w-4 border-t-2 border-dashed border-slate-500 dark:border-slate-400" />
                        Total Aportado (custo)
                      </span>
                    </div>
                  )
                )}
              </>
            )}
          </div>

          {/* Chart 2: Aportes (Mensais / Diários) */}
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {contributionGrouping === "MONTHLY"
                    ? "Aportes Mensais"
                    : "Aportes por Dia"}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Compras menos vendas (ajustes de rendimento excluídos) ·{" "}
                  {selectionDescription}
                </p>
              </div>

              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 text-xs font-semibold dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setContributionGrouping("MONTHLY")}
                  className={cn(
                    "rounded-lg px-3 py-1 transition-colors",
                    contributionGrouping === "MONTHLY"
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Por mês
                </button>
                <button
                  type="button"
                  onClick={() => setContributionGrouping("DAILY")}
                  className={cn(
                    "rounded-lg px-3 py-1 transition-colors",
                    contributionGrouping === "DAILY"
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  Por dia
                </button>
              </div>
            </div>

            {contributionSeries.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                Nenhum aporte registrado no período e filtro selecionados.
              </div>
            ) : (
              <>
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={contributionSeries}
                      margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
                      stackOffset="sign"
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke={gridStroke}
                        vertical={false}
                      />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: axisTickFill }}
                        tickLine={false}
                        axisLine={{ stroke: gridStroke }}
                        minTickGap={20}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: axisTickFill }}
                        tickLine={false}
                        axisLine={false}
                        width={68}
                        tickFormatter={(val: number) =>
                          isPrivate ? MASKED_COMPACT : formatCompactBRL(val)
                        }
                      />
                      <ReferenceLine y={0} stroke={refLineStroke} />
                      <Tooltip
                        content={
                          <ContributionTooltip
                            activeClasses={activeClasses}
                            isPrivate={isPrivate}
                          />
                        }
                      />
                      {activeClasses.map((cls) => (
                        <Bar
                          key={cls}
                          dataKey={cls}
                          name={ASSET_CLASS_LABELS[cls]}
                          stackId="aportes"
                          fill={ASSET_CLASS_COLORS[cls]}
                          maxBarSize={42}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-600 dark:text-slate-400">
                  {activeClasses.map((cls) => (
                    <span
                      key={cls}
                      className="inline-flex items-center gap-1.5"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-xs"
                        style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                      />
                      {ASSET_CLASS_LABELS[cls]}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
