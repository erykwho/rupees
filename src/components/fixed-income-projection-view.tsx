"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  Coins,
  Landmark,
  Pencil,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Wallet,
  X,
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
import {
  FIXED_INCOME_INDEXES,
  FIXED_INCOME_INDEX_LABELS,
  type FixedIncomeIndexKey,
  formatPct,
} from "@/lib/domain/types";
import {
  type BenchmarkRates,
  type FixedIncomeAssetProjection,
  type FixedIncomeHorizonKey,
  type FixedIncomeProjectionPoint,
  type FixedIncomeScopeKey,
  computeFixedIncomeProjection,
  formatFixedIncomeRate,
  formatMaturityDatePTBR,
  suggestFixedIncomeConfig,
} from "@/lib/domain/fixed-income";
import type { FixedIncomeInitialData } from "@/lib/fixed-income-loader";
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import {
  ZoomableChartContainer,
  useChartZoom,
} from "@/components/zoomable-chart";
import { MASKED_COMPACT, maskBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

const getProjectionRangeLabel = (pt: FixedIncomeProjectionPoint) =>
  pt.tooltipLabel;

const HORIZON_OPTIONS: Array<{ value: FixedIncomeHorizonKey; label: string }> = [
  { value: "1A", label: "1A" },
  { value: "2A", label: "2A" },
  { value: "5A", label: "5A" },
  { value: "10A", label: "10A" },
  { value: "MAX_MATURITY", label: "Venc." },
];

const SCOPE_OPTIONS: Array<{ value: FixedIncomeScopeKey; label: string }> = [
  { value: "FIXED_INCOME", label: "Renda Fixa" },
  { value: "EMERGENCY_RESERVE", label: "Reserva" },
  { value: "ALL", label: "Ambos" },
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

function getRateInputLabel(index: FixedIncomeIndexKey): string {
  switch (index) {
    case "CDI_PCT":
      return "% do CDI";
    case "CDI_PLUS":
      return "CDI + (% a.a.)";
    case "SELIC_PCT":
      return "% da Selic";
    case "SELIC_PLUS":
      return "Selic + (% a.a.)";
    case "IPCA_PLUS":
      return "IPCA + (% a.a.)";
    case "PREFIXED":
      return "Taxa (% a.a.)";
  }
}

function getRateInputPlaceholder(index: FixedIncomeIndexKey): string {
  switch (index) {
    case "CDI_PCT":
    case "SELIC_PCT":
      return "Ex: 100";
    case "CDI_PLUS":
    case "SELIC_PLUS":
      return "Ex: 1,50";
    case "IPCA_PLUS":
      return "Ex: 6,50";
    case "PREFIXED":
      return "Ex: 12,50";
  }
}

interface ProjectionTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: FixedIncomeProjectionPoint }>;
  isPrivate: boolean;
}

function ProjectionTooltip({
  active,
  payload,
  isPrivate,
}: ProjectionTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0]?.payload;
  if (!pt) return null;

  return (
    <div className="pointer-events-none hidden min-w-[175px] max-w-[230px] rounded-lg border border-slate-200/90 bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-xs sm:block dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 border-b border-slate-100 pb-1 dark:border-slate-800">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {pt.tooltipLabel}
        </span>
        <span className="text-[10px] font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
          +{maskBRL(pt.netGainBRL, isPrivate)}
        </span>
      </div>
      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Líquido
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(pt.netValueBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Base
          </span>
          <span className="font-medium text-slate-600 dark:text-slate-300">
            {maskBRL(pt.principalBRL, isPrivate)}
          </span>
        </div>
        {pt.maturedTickers.length > 0 && (
          <div className="mt-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Vence: {pt.maturedTickers.join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

interface ProjectionMobileReadoutProps {
  point: FixedIncomeProjectionPoint | null;
  isPointActive: boolean;
  isPrivate: boolean;
}

function ProjectionMobileReadout({
  point,
  isPointActive,
  isPrivate,
}: ProjectionMobileReadoutProps) {
  if (!point) return null;

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
          {maskBRL(point.netValueBRL, isPrivate)}
        </span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
          +{maskBRL(point.netGainBRL, isPrivate)}
        </span>
      </div>
    </div>
  );
}

interface ConfigModalState {
  asset: FixedIncomeAssetProjection;
  fixedIncomeIndex: FixedIncomeIndexKey;
  fixedIncomeRate: string;
  maturityDate: string;
  taxExempt: boolean;
}

interface FixedIncomeProjectionViewProps {
  initialData: FixedIncomeInitialData;
}

export function FixedIncomeProjectionView({
  initialData,
}: FixedIncomeProjectionViewProps) {
  const { isPrivate } = usePrivacy();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [data, setData] = useState<FixedIncomeInitialData>(initialData);
  const [refreshingBcb, setRefreshingBcb] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // Simulator overrides (defaults to loaded BCB rates)
  const [selicInput, setSelicInput] = useState(
    String(initialData.benchmarks.selic)
  );
  const [cdiInput, setCdiInput] = useState(String(initialData.benchmarks.cdi));
  const [ipcaInput, setIpcaInput] = useState(
    String(initialData.benchmarks.ipca)
  );
  const [monthlyContributionInput, setMonthlyContributionInput] = useState("0");

  const [horizon, setHorizon] = useState<FixedIncomeHorizonKey>("2A");
  const [scope, setScope] = useState<FixedIncomeScopeKey>(() => {
    const hasFi = initialData.assets.some(
      (a) => a.assetClass === "FIXED_INCOME" && a.currentValueBRL > 0
    );
    return hasFi ? "FIXED_INCOME" : "ALL";
  });

  // Inline config / backfill modal
  const [configModal, setConfigModal] = useState<ConfigModalState | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);

  const parseNum = (raw: string, fallback: number) => {
    const n = Number(raw.replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  const simulatedBenchmarks: BenchmarkRates = useMemo(
    () => ({
      selic: parseNum(selicInput, data.benchmarks.selic),
      cdi: parseNum(cdiInput, data.benchmarks.cdi),
      ipca: parseNum(ipcaInput, data.benchmarks.ipca),
      updatedAt: data.benchmarks.updatedAt,
      source: data.benchmarks.source,
    }),
    [selicInput, cdiInput, ipcaInput, data.benchmarks]
  );

  const monthlyContributionBRL = parseNum(monthlyContributionInput, 0);

  const isSimulated =
    Math.abs(simulatedBenchmarks.selic - data.benchmarks.selic) > 0.001 ||
    Math.abs(simulatedBenchmarks.cdi - data.benchmarks.cdi) > 0.001 ||
    Math.abs(simulatedBenchmarks.ipca - data.benchmarks.ipca) > 0.001 ||
    monthlyContributionBRL > 0;

  const projection = useMemo(
    () =>
      computeFixedIncomeProjection({
        assets: data.assets,
        benchmarks: simulatedBenchmarks,
        horizon,
        scope,
        monthlyContributionBRL,
      }),
    [data.assets, simulatedBenchmarks, horizon, scope, monthlyContributionBRL]
  );

  const projectionZoom = useChartZoom(projection.series, {
    resetKey: `${horizon}|${scope}`,
    minVisiblePoints: 3,
    plotLeftInset: 68,
    plotRightInset: 8,
    getRangeLabel: getProjectionRangeLabel,
  });

  const activeTotals = useMemo(() => {
    const fi = projection.fixedIncomeTotals;
    const res = projection.emergencyReserveTotals;
    if (scope === "FIXED_INCOME") return fi;
    if (scope === "EMERGENCY_RESERVE") return res;
    const configuredTotal = fi.configuredValueBRL + res.configuredValueBRL;
    const weightedAnnualGrossRatePct =
      configuredTotal > 0
        ? (fi.configuredValueBRL * fi.weightedAnnualGrossRatePct +
            res.configuredValueBRL * res.weightedAnnualGrossRatePct) /
          configuredTotal
        : 0;
    return {
      totalValueBRL: fi.totalValueBRL + res.totalValueBRL,
      weightedAnnualGrossRatePct,
      monthlyNetBRL: fi.monthlyNetBRL + res.monthlyNetBRL,
      annualNetBRL: fi.annualNetBRL + res.annualNetBRL,
    };
  }, [scope, projection.fixedIncomeTotals, projection.emergencyReserveTotals]);

  const fixedIncomeAssets = useMemo(
    () =>
      projection.assets
        .filter(
          (a) =>
            a.assetClass === "FIXED_INCOME" &&
            (a.isActive || a.currentValueBRL > 0)
        )
        .sort((a, b) => b.currentValueBRL - a.currentValueBRL),
    [projection.assets]
  );

  const reserveAssets = useMemo(
    () =>
      projection.assets
        .filter(
          (a) =>
            a.assetClass === "EMERGENCY_RESERVE" &&
            (a.isActive || a.currentValueBRL > 0)
        )
        .sort((a, b) => b.currentValueBRL - a.currentValueBRL),
    [projection.assets]
  );

  const hasAnyMaturity = projection.maxMaturityMonths !== null;

  async function reloadFixedIncome(forceRefresh = false) {
    if (forceRefresh) setRefreshingBcb(true);
    try {
      const res = await fetch(
        forceRefresh ? "/api/fixed-income?refresh=true" : "/api/fixed-income"
      );
      if (res.ok) {
        const next: FixedIncomeInitialData = await res.json();
        setData(next);
        if (forceRefresh) {
          setSelicInput(String(next.benchmarks.selic));
          setCdiInput(String(next.benchmarks.cdi));
          setIpcaInput(String(next.benchmarks.ipca));
        }
      }
    } finally {
      if (forceRefresh) setRefreshingBcb(false);
    }
  }

  function resetBenchmarksToBcb() {
    setSelicInput(String(data.benchmarks.selic));
    setCdiInput(String(data.benchmarks.cdi));
    setIpcaInput(String(data.benchmarks.ipca));
    setMonthlyContributionInput("0");
  }

  function openConfigModal(asset: FixedIncomeAssetProjection) {
    setConfigError(null);
    if (asset.isConfigured && asset.fixedIncomeIndex) {
      setConfigModal({
        asset,
        fixedIncomeIndex: asset.fixedIncomeIndex,
        fixedIncomeRate:
          asset.fixedIncomeRate !== null ? String(asset.fixedIncomeRate) : "",
        maturityDate: asset.maturityDate ?? "",
        taxExempt: asset.taxExempt,
      });
    } else {
      const suggestion = suggestFixedIncomeConfig(
        asset.ticker,
        asset.assetClass
      );
      setConfigModal({
        asset,
        fixedIncomeIndex: suggestion.fixedIncomeIndex,
        fixedIncomeRate: String(suggestion.fixedIncomeRate),
        maturityDate: suggestion.maturityDate,
        taxExempt: suggestion.taxExempt,
      });
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!configModal) return;
    setSavingConfig(true);
    setConfigError(null);

    try {
      const rateNum = Number(configModal.fixedIncomeRate.replace(",", "."));
      if (!Number.isFinite(rateNum) || rateNum < 0) {
        setConfigError("Informe uma taxa válida (≥ 0).");
        return;
      }

      const res = await fetch(`/api/assets/${configModal.asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixedIncomeIndex: configModal.fixedIncomeIndex,
          fixedIncomeRate: rateNum,
          maturityDate: configModal.maturityDate || null,
          taxExempt: configModal.taxExempt,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setConfigError(errData.error ?? "Erro ao salvar configuração.");
        return;
      }

      setConfigModal(null);
      await reloadFixedIncome(false);
    } finally {
      setSavingConfig(false);
    }
  }

  const chartGridColor = isDark ? "#1e293b" : "#f1f5f9";
  const chartTickColor = isDark ? "#94a3b8" : "#64748b";

  if (projection.assets.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <Landmark className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
        <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
          Nenhum título de Renda Fixa ou Reserva
        </h2>
      </div>
    );
  }

  const horizonOptions = HORIZON_OPTIONS.filter(
    (opt) => opt.value !== "MAX_MATURITY" || hasAnyMaturity
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Unconfigured Assets Strip */}
      {projection.unconfiguredAssets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="font-semibold">Sem taxa:</span>
          {projection.unconfiguredAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => openConfigModal(asset)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200"
            >
              <Sparkles className="h-3 w-3 text-amber-500" />
              {asset.ticker}
            </button>
          ))}
        </div>
      )}

      {/* Collapsible Benchmark Simulator Bar */}
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
              Selic {formatPct(simulatedBenchmarks.selic, 2)} · CDI{" "}
              {formatPct(simulatedBenchmarks.cdi, 2)} · IPCA{" "}
              {formatPct(simulatedBenchmarks.ipca, 1)}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-1.5">
            {isSimulated && (
              <button
                type="button"
                onClick={resetBenchmarksToBcb}
                title="Restaurar taxas BCB"
                aria-label="Restaurar taxas BCB"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => reloadFixedIncome(true)}
              disabled={refreshingBcb}
              title="Atualizar taxas do Banco Central"
              aria-label="Atualizar taxas do Banco Central"
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshingBcb && "animate-spin")}
              />
            </button>
            <button
              type="button"
              onClick={() => setSimulatorOpen((prev) => !prev)}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors",
                simulatorOpen || isSimulated
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
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 p-4 sm:grid-cols-4 dark:border-slate-800">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Selic (% a.a.)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={selicInput}
                onChange={(e) => setSelicInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                CDI (% a.a.)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={cdiInput}
                onChange={(e) => setCdiInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                IPCA 12m (% a.a.)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={ipcaInput}
                onChange={(e) => setIpcaInput(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Aporte mensal (R$)
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={monthlyContributionInput}
                onChange={(e) => setMonthlyContributionInput(e.target.value)}
                placeholder="0"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 font-mono text-sm font-semibold tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </label>
          </div>
        )}
      </section>

      {/* Single-Row Scope & Horizon Controls */}
      <div className="flex items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-3 rounded-xl bg-slate-100 p-0.5 sm:inline-flex sm:flex-none dark:bg-slate-800">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setScope(opt.value)}
              className={cn(
                "whitespace-nowrap rounded-lg px-2 py-1 text-xs font-semibold transition sm:px-3",
                scope === opt.value
                  ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Mobile Native Horizon Select */}
        <div className="relative shrink-0 sm:hidden">
          <Calendar
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-emerald-600 dark:text-emerald-400"
          />
          <select
            aria-label="Horizonte"
            value={horizon}
            onChange={(e) =>
              setHorizon(e.target.value as FixedIncomeHorizonKey)
            }
            className="h-8 appearance-none rounded-xl border border-slate-200 bg-white pl-7 pr-6 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {horizonOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
        </div>

        {/* Desktop Horizon Chips */}
        <div className="hidden rounded-xl bg-slate-100 p-0.5 sm:inline-flex dark:bg-slate-800">
          {horizonOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setHorizon(opt.value)}
              className={cn(
                "whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold transition",
                horizon === opt.value
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Unified Net-Focused KPI Strip (2x2 on mobile, 4-col on desktop) */}
      <CompactKpiStrip
        columns={4}
        items={[
          {
            id: "fi-balance",
            label: "Saldo Atual",
            value: maskBRL(activeTotals.totalValueBRL, isPrivate),
            icon: (
              <Wallet className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            ),
            subtext:
              activeTotals.weightedAnnualGrossRatePct > 0
                ? `${formatPct(activeTotals.weightedAnnualGrossRatePct, 2)} a.a.`
                : null,
          },
          {
            id: "fi-monthly",
            label: "Líquido / mês",
            value: `+${maskBRL(activeTotals.monthlyNetBRL, isPrivate)}`,
            icon: (
              <Coins className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            valueClassName: "text-emerald-700 dark:text-emerald-400",
          },
          {
            id: "fi-annual",
            label: "Líquido / ano",
            value: `+${maskBRL(activeTotals.annualNetBRL, isPrivate)}`,
            icon: (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            valueClassName: "text-emerald-700 dark:text-emerald-400",
          },
          {
            id: "fi-final",
            label: `Final (${projection.horizonMonths}m)`,
            value: maskBRL(projection.finalPoint.netValueBRL, isPrivate),
            icon: (
              <Landmark className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            subtext: `+${maskBRL(projection.finalPoint.netGainBRL, isPrivate)} líq.`,
            highlighted: true,
          },
        ]}
      />

      {/* Net Growth Chart */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-bold text-slate-900 sm:text-base dark:text-slate-100">
          Crescimento Líquido
        </h2>

        <ZoomableChartContainer
          containerRef={projectionZoom.containerRef}
          isZoomed={projectionZoom.isZoomed}
          isInteracting={projectionZoom.isInteracting}
          rangeLabel={projectionZoom.rangeLabel}
          onResetZoom={projectionZoom.resetZoom}
          mobileReadout={
            <ProjectionMobileReadout
              point={projectionZoom.displayPoint}
              isPointActive={projectionZoom.isPointActive}
              isPrivate={isPrivate}
            />
          }
          className="h-[250px] sm:h-[300px]"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={projectionZoom.visibleData}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              {...projectionZoom.chartEventHandlers}
            >
              <defs>
                <linearGradient id="fiNetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
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
                domain={
                  projectionZoom.isZoomed ? ["auto", "auto"] : undefined
                }
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
                  ...(projectionZoom.isInteracting ? { display: "none" } : {}),
                }}
                content={<ProjectionTooltip isPrivate={isPrivate} />}
              />
              <Area
                type="monotone"
                dataKey="netValueBRL"
                name="Líquido"
                stroke="#10b981"
                strokeWidth={2.25}
                fill="url(#fiNetGrad)"
                isAnimationActive={
                  !projectionZoom.isInteracting && !projectionZoom.isZoomed
                }
              />
              <Area
                type="monotone"
                dataKey="principalBRL"
                name="Base"
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                fill="none"
                isAnimationActive={
                  !projectionZoom.isInteracting && !projectionZoom.isZoomed
                }
              />
            </AreaChart>
          </ResponsiveContainer>
        </ZoomableChartContainer>
      </section>

      {/* Concise Bond Lists */}
      {fixedIncomeAssets.length > 0 && (
        <AssetProjectionSection
          title="Títulos de Renda Fixa"
          assets={fixedIncomeAssets}
          isPrivate={isPrivate}
          onConfigure={openConfigModal}
        />
      )}

      {reserveAssets.length > 0 && (
        <AssetProjectionSection
          title="Reserva de Emergência"
          assets={reserveAssets}
          isPrivate={isPrivate}
          onConfigure={openConfigModal}
        />
      )}

      {/* Inline Configuration Modal */}
      {configModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-xs"
          onClick={() => !savingConfig && setConfigModal(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {configModal.asset.ticker}
              </h3>
              <button
                type="button"
                onClick={() => setConfigModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="mt-4 space-y-3.5">
              {configError && (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {configError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Indexador
                  </span>
                  <select
                    value={configModal.fixedIncomeIndex}
                    onChange={(e) =>
                      setConfigModal({
                        ...configModal,
                        fixedIncomeIndex: e.target.value as FixedIncomeIndexKey,
                      })
                    }
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {FIXED_INCOME_INDEXES.map((idx) => (
                      <option key={idx} value={idx}>
                        {FIXED_INCOME_INDEX_LABELS[idx]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {getRateInputLabel(configModal.fixedIncomeIndex)}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={configModal.fixedIncomeRate}
                    onChange={(e) =>
                      setConfigModal({
                        ...configModal,
                        fixedIncomeRate: e.target.value,
                      })
                    }
                    placeholder={getRateInputPlaceholder(
                      configModal.fixedIncomeIndex
                    )}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm tabular-nums text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Vencimento (opcional)
                </span>
                <input
                  type="date"
                  value={configModal.maturityDate}
                  onChange={(e) =>
                    setConfigModal({
                      ...configModal,
                      maturityDate: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={configModal.taxExempt}
                  onChange={(e) =>
                    setConfigModal({
                      ...configModal,
                      taxExempt: e.target.checked,
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                Isento de IR (LCI, LCA, CRI, CRA)
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigModal(null)}
                  disabled={savingConfig}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingConfig ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function AssetProjectionSection({
  title,
  assets,
  isPrivate,
  onConfigure,
}: {
  title: string;
  assets: FixedIncomeAssetProjection[];
  isPrivate: boolean;
  onConfigure: (asset: FixedIncomeAssetProjection) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
      </div>

      {/* Desktop Compact Table (Net-Focused) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th className="px-4 py-2.5">Ativo</th>
              <th className="px-3 py-2.5">Taxa</th>
              <th className="px-3 py-2.5">Vencimento</th>
              <th className="px-3 py-2.5 text-right">Saldo</th>
              <th className="px-3 py-2.5 text-right">Mês / Ano Líq.</th>
              <th className="px-4 py-2.5 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {assets.map((asset) => (
              <tr
                key={asset.id}
                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {asset.ticker}
                    </span>
                    {asset.taxExempt && (
                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Isento
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {asset.isConfigured ? (
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {formatFixedIncomeRate(
                        asset.fixedIncomeIndex,
                        asset.effectiveContractedRate
                      )}
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Configurar
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 font-mono text-slate-500 dark:text-slate-400">
                  {formatMaturityDatePTBR(asset.maturityDate)}
                </td>
                <td className="px-3 py-3 text-right font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {maskBRL(asset.currentValueBRL, isPrivate)}
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">
                  {asset.isConfigured ? (
                    <>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{maskBRL(asset.monthlyNetBRL, isPrivate)}
                      </span>
                      <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                        / +{maskBRL(asset.annualNetBRL, isPrivate)}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onConfigure(asset)}
                    title={asset.isConfigured ? "Editar taxa" : "Configurar taxa"}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <Pencil className="h-3 w-3" />
                    {asset.isConfigured ? "Editar" : "Definir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Compact List */}
      <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {assets.map((asset) => (
          <div key={asset.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                    {asset.ticker}
                  </span>
                  {asset.taxExempt && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Isento
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  {asset.isConfigured
                    ? formatFixedIncomeRate(
                        asset.fixedIncomeIndex,
                        asset.effectiveContractedRate
                      )
                    : "Taxa não definida"}
                  {asset.maturityDate &&
                    ` · ${formatMaturityDatePTBR(asset.maturityDate)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onConfigure(asset)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300"
              >
                <Pencil className="h-3 w-3" />
                {asset.isConfigured ? "Editar" : "Definir"}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50/80 px-2.5 py-2 text-xs tabular-nums dark:bg-slate-800/50">
              <div>
                <p className="text-[10px] text-slate-500">Saldo</p>
                <p className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {maskBRL(asset.currentValueBRL, isPrivate)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Mês líq.</p>
                <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {asset.isConfigured
                    ? `+${maskBRL(asset.monthlyNetBRL, isPrivate)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Ano líq.</p>
                <p className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                  {asset.isConfigured
                    ? `+${maskBRL(asset.annualNetBRL, isPrivate)}`
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
