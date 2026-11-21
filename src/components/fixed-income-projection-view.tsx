"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Landmark,
  Pencil,
  RefreshCw,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
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
  type FixedIncomeClassTotals,
  type FixedIncomeHorizonKey,
  type FixedIncomeProjectionPoint,
  type FixedIncomeScopeKey,
  computeFixedIncomeProjection,
  formatFixedIncomeRate,
  formatMaturityDatePTBR,
  suggestFixedIncomeConfig,
} from "@/lib/domain/fixed-income";
import type { FixedIncomeInitialData } from "@/lib/fixed-income-loader";
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
  { value: "MAX_MATURITY", label: "Vencimento" },
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
      return "Percentual do CDI (%)";
    case "CDI_PLUS":
      return "Spread sobre CDI (% a.a.)";
    case "SELIC_PCT":
      return "Percentual da Selic (%)";
    case "SELIC_PLUS":
      return "Spread sobre Selic (% a.a.)";
    case "IPCA_PLUS":
      return "Taxa fixa sobre IPCA (% a.a.)";
    case "PREFIXED":
      return "Taxa prefixada (% a.a.)";
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
    <div className="min-w-[230px] rounded-xl border border-slate-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-xs dark:border-slate-700 dark:bg-slate-900/95">
      <p className="mb-2 border-b border-slate-100 pb-1.5 font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-100">
        {pt.tooltipLabel}
      </p>
      <div className="space-y-1.5 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Líquido (após IR)
          </span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {maskBRL(pt.netValueBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-pink-500" />
            Bruto
          </span>
          <span className="font-medium text-slate-700 dark:text-slate-200">
            {maskBRL(pt.grossValueBRL, isPrivate)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Capital base
          </span>
          <span className="font-medium text-slate-600 dark:text-slate-300">
            {maskBRL(pt.principalBRL, isPrivate)}
          </span>
        </div>
        <div className="border-t border-slate-100 pt-1.5 dark:border-slate-800">
          <div className="flex items-center justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">
              Ganho líquido
            </span>
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              +{maskBRL(pt.netGainBRL, isPrivate)}
            </span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-4">
            <span className="text-slate-500 dark:text-slate-400">
              Ganho bruto
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              +{maskBRL(pt.grossGainBRL, isPrivate)}
            </span>
          </div>
        </div>
        {pt.maturedTickers.length > 0 && (
          <div className="mt-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            Vencimento: {pt.maturedTickers.join(", ")}
          </div>
        )}
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

  // Simulator overrides (defaults to loaded BCB rates)
  const [selicInput, setSelicInput] = useState(String(initialData.benchmarks.selic));
  const [cdiInput, setCdiInput] = useState(String(initialData.benchmarks.cdi));
  const [ipcaInput, setIpcaInput] = useState(String(initialData.benchmarks.ipca));
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

  const isSimulated =
    Math.abs(simulatedBenchmarks.selic - data.benchmarks.selic) > 0.001 ||
    Math.abs(simulatedBenchmarks.cdi - data.benchmarks.cdi) > 0.001 ||
    Math.abs(simulatedBenchmarks.ipca - data.benchmarks.ipca) > 0.001;

  const monthlyContributionBRL = parseNum(monthlyContributionInput, 0);

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

  const fixedIncomeAssets = useMemo(
    () =>
      projection.assets
        .filter((a) => a.assetClass === "FIXED_INCOME" && (a.isActive || a.currentValueBRL > 0))
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

  const maturedInHorizon = useMemo(() => {
    const set = new Set<string>();
    for (const pt of projection.series) {
      for (const t of pt.maturedTickers) set.add(t);
    }
    return Array.from(set);
  }, [projection.series]);

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
        setConfigError("Informe uma taxa válida (número maior ou igual a 0).");
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
        <Landmark className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
        <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">
          Nenhum ativo de Renda Fixa ou Reserva cadastrado
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Cadastre seus títulos de Renda Fixa ou Reserva de Emergência na aba
          Carteira para acompanhar o rendimento esperado.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Guided Backfill Banner */}
      {projection.unconfiguredAssets.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {projection.unconfiguredAssets.length === 1
                    ? "1 ativo ainda sem taxa configurada"
                    : `${projection.unconfiguredAssets.length} ativos ainda sem taxa configurada`}
                </h3>
                <p className="mt-0.5 text-xs text-amber-800/90 dark:text-amber-300/80">
                  Configure o indexador, taxa e vencimento para incluí-los na
                  projeção de rendimento esperado.
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {projection.unconfiguredAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => openConfigModal(asset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 shadow-2xs transition hover:bg-amber-100 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Configurar {asset.ticker}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Benchmark Simulator Bar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Premissas e Simulador
            </h2>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                isSimulated
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  : data.benchmarks.source === "fallback"
                    ? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
              )}
            >
              {isSimulated
                ? "Cenário simulado"
                : data.benchmarks.source === "fallback"
                  ? "Referência padrão"
                  : "Banco Central (BCB)"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {isSimulated && (
              <button
                type="button"
                onClick={resetBenchmarksToBcb}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar BCB
              </button>
            )}
            <button
              type="button"
              onClick={() => reloadFixedIncome(true)}
              disabled={refreshingBcb}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", refreshingBcb && "animate-spin")}
              />
              Atualizar BCB
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Selic (% a.a.)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={selicInput}
              onChange={(e) => setSelicInput(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
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
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
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
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Aporte mensal simulado (R$)
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={monthlyContributionInput}
              onChange={(e) => setMonthlyContributionInput(e.target.value)}
              placeholder="0"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium tabular-nums text-slate-900 outline-none focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-100 dark:focus:bg-slate-900"
            />
          </label>
        </div>
      </section>

      {/* Separate Summary Cards: Renda Fixa & Reserva de Emergência */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClassSummaryCard
          title="Renda Fixa"
          subtitle="Alocada na carteira de investimentos"
          icon={<Landmark className="h-4 w-4 text-pink-600 dark:text-pink-400" />}
          accentBg="bg-pink-50 dark:bg-pink-950/40"
          totals={projection.fixedIncomeTotals}
          isPrivate={isPrivate}
        />
        <ClassSummaryCard
          title="Reserva de Emergência"
          subtitle="Mantida separada da carteira"
          icon={<Shield className="h-4 w-4 text-slate-600 dark:text-slate-300" />}
          accentBg="bg-slate-100 dark:bg-slate-800"
          totals={projection.emergencyReserveTotals}
          isPrivate={isPrivate}
        />
      </div>

      {/* Projection Chart */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Projeção de Crescimento
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Juros compostos a partir do saldo atual
              {monthlyContributionBRL > 0
                ? ` + aporte mensal de ${maskBRL(monthlyContributionBRL, isPrivate)}`
                : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Scope selector */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setScope(opt.value)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                    scope === opt.value
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Horizon selector */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800">
              {HORIZON_OPTIONS.filter(
                (opt) => opt.value !== "MAX_MATURITY" || hasAnyMaturity
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setHorizon(opt.value)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition",
                    horizon === opt.value
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chart End-of-Horizon Summary Pills */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Capital base ({projection.horizonMonths}m)
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {maskBRL(projection.finalPoint.principalBRL, isPrivate)}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50/70 p-3 dark:bg-emerald-950/30">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
              Patrimônio líquido final
            </p>
            <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              {maskBRL(projection.finalPoint.netValueBRL, isPrivate)}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50/40 p-3 dark:bg-emerald-950/20">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Ganho líquido projetado
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{maskBRL(projection.finalPoint.netGainBRL, isPrivate)}
            </p>
          </div>
          <div className="rounded-xl bg-pink-50/50 p-3 dark:bg-pink-950/20">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Ganho bruto projetado
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-pink-600 dark:text-pink-400">
              +{maskBRL(projection.finalPoint.grossGainBRL, isPrivate)}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <ZoomableChartContainer
            containerRef={projectionZoom.containerRef}
            isZoomed={projectionZoom.isZoomed}
            isInteracting={projectionZoom.isInteracting}
            rangeLabel={projectionZoom.rangeLabel}
            onResetZoom={projectionZoom.resetZoom}
            className="h-[280px] sm:h-[320px]"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={projectionZoom.visibleData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fiGrossGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ec4899" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                  </linearGradient>
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
                  wrapperStyle={
                    projectionZoom.isInteracting
                      ? { display: "none" }
                      : undefined
                  }
                  content={<ProjectionTooltip isPrivate={isPrivate} />}
                />
                <Area
                  type="monotone"
                  dataKey="grossValueBRL"
                  name="Bruto"
                  stroke="#ec4899"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  fill="url(#fiGrossGrad)"
                  isAnimationActive={
                    !projectionZoom.isInteracting && !projectionZoom.isZoomed
                  }
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
                  name="Capital base"
                  stroke="#94a3b8"
                  strokeWidth={1.5}
                  fill="none"
                  isAnimationActive={
                    !projectionZoom.isInteracting && !projectionZoom.isZoomed
                  }
                />
              </AreaChart>
            </ResponsiveContainer>
          </ZoomableChartContainer>
        </div>

        {maturedInHorizon.length > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Calendar className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>
              Títulos com vencimento neste horizonte (
              <strong>{maturedInHorizon.join(", ")}</strong>) param de render na
              data de vencimento e mantêm o saldo resgatado constante no restante
              do gráfico.
            </span>
          </p>
        )}
      </section>

      {/* Detailed Assets Breakdown */}
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

      {/* Inline Configuration / Backfill Modal */}
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
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Configurar {configModal.asset.ticker}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Defina indexador, taxa padrão, vencimento e tributação
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfigModal(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="mt-4 space-y-4">
              {configError && (
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  {configError}
                </div>
              )}

              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
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
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
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
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm tabular-nums text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Data de vencimento (opcional)
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
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <span className="mt-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Deixe em branco para títulos com liquidez diária ou sem
                  vencimento definido.
                </span>
              </label>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-700">
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
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  Isento de Imposto de Renda (LCI, LCA, CRI, CRA, Debênture
                  incentivada)
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfigModal(null)}
                  disabled={savingConfig}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingConfig}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingConfig ? "Salvando..." : "Salvar taxa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ClassSummaryCard({
  title,
  subtitle,
  icon,
  accentBg,
  totals,
  isPrivate,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accentBg: string;
  totals: FixedIncomeClassTotals;
  isPrivate: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              accentBg
            )}
          >
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Taxa média bruta
          </p>
          <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {totals.weightedAnnualGrossRatePct > 0
              ? `${formatPct(totals.weightedAnnualGrossRatePct, 2)} a.a.`
              : "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Saldo atual
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {maskBRL(totals.totalValueBRL, isPrivate)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Esperado / mês
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            +{maskBRL(totals.monthlyNetBRL, isPrivate)}
          </p>
          <p className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            Bruto: +{maskBRL(totals.monthlyGrossBRL, isPrivate)}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Esperado / ano
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            +{maskBRL(totals.annualNetBRL, isPrivate)}
          </p>
          <p className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
            Bruto: +{maskBRL(totals.annualGrossBRL, isPrivate)}
          </p>
        </div>
      </div>
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
    <section className="rounded-2xl border border-slate-200 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h3>
      </div>

      {/* Desktop Table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="px-4 py-2.5 font-medium">Ativo</th>
              <th className="px-3 py-2.5 font-medium">Taxa / Indexador</th>
              <th className="px-3 py-2.5 font-medium">Vencimento</th>
              <th className="px-3 py-2.5 font-medium">IR</th>
              <th className="px-3 py-2.5 text-right font-medium">Saldo Atual</th>
              <th className="px-3 py-2.5 text-right font-medium">
                Mensal (Líq. / Bruto)
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                Anual (Líq. / Bruto)
              </th>
              <th className="px-3 py-2.5 text-right font-medium">
                No Vencimento
              </th>
              <th className="px-3 py-2.5 text-right font-medium">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {assets.map((asset) => (
              <tr
                key={asset.id}
                className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-slate-900 dark:text-slate-100">
                    {asset.ticker}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {asset.sector}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {asset.isConfigured ? (
                    <div>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {formatFixedIncomeRate(
                          asset.fixedIncomeIndex,
                          asset.effectiveContractedRate
                        )}
                      </span>
                      <div className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        ≈ {formatPct(asset.annualGrossRatePct, 2)} a.a.
                        {asset.hasLotRateOverride && (
                          <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] dark:bg-slate-800">
                            média {asset.lotsWithRateCount} lote
                            {asset.lotsWithRateCount === 1 ? "" : "s"}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Não configurado
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                  {formatMaturityDatePTBR(asset.maturityDate)}
                  {asset.isMatured && (
                    <span className="ml-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      Vencido
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums text-slate-600 dark:text-slate-300">
                  {asset.taxExempt
                    ? "Isento"
                    : `${(asset.currentIrRate * 100).toFixed(1).replace(".", ",")}%`}
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                  {maskBRL(asset.currentValueBRL, isPrivate)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {asset.isConfigured ? (
                    <>
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{maskBRL(asset.monthlyNetBRL, isPrivate)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        +{maskBRL(asset.monthlyGrossBRL, isPrivate)}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {asset.isConfigured ? (
                    <>
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{maskBRL(asset.annualNetBRL, isPrivate)}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        +{maskBRL(asset.annualGrossBRL, isPrivate)}
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {asset.isConfigured &&
                  asset.maturityNetValueBRL !== null &&
                  asset.maturityNetGainBRL !== null ? (
                    <>
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {maskBRL(asset.maturityNetValueBRL, isPrivate)}
                      </div>
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        +
                        {maskBRL(asset.maturityNetGainBRL, isPrivate)}{" "}
                        líq.
                      </div>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => onConfigure(asset)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Pencil className="h-3 w-3" />
                    {asset.isConfigured ? "Editar" : "Configurar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
        {assets.map((asset) => (
          <div key={asset.id} className="space-y-2.5 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {asset.ticker}
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {asset.taxExempt
                      ? "Isento IR"
                      : `IR ${(asset.currentIrRate * 100).toFixed(1).replace(".", ",")}%`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {asset.isConfigured
                    ? `${formatFixedIncomeRate(asset.fixedIncomeIndex, asset.effectiveContractedRate)} (≈ ${formatPct(asset.annualGrossRatePct, 2)} a.a.)`
                    : "Taxa não configurada"}
                </p>
                <p className="text-[11px] text-slate-400">
                  {formatMaturityDatePTBR(asset.maturityDate)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onConfigure(asset)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                <Pencil className="h-3 w-3" />
                {asset.isConfigured ? "Editar" : "Configurar"}
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2.5 text-xs tabular-nums dark:bg-slate-800/50">
              <div>
                <p className="text-[10px] text-slate-500">Saldo</p>
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {maskBRL(asset.currentValueBRL, isPrivate)}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Mensal (Líq.)</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {asset.isConfigured
                    ? `+${maskBRL(asset.monthlyNetBRL, isPrivate)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500">Anual (Líq.)</p>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {asset.isConfigured
                    ? `+${maskBRL(asset.annualNetBRL, isPrivate)}`
                    : "—"}
                </p>
              </div>
            </div>

            {asset.isConfigured &&
              asset.maturityNetValueBRL !== null &&
              asset.maturityNetGainBRL !== null && (
                <div className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2 text-xs tabular-nums dark:border-slate-800">
                  <span className="text-slate-500 dark:text-slate-400">
                    No vencimento ({formatMaturityDatePTBR(asset.maturityDate)})
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {maskBRL(asset.maturityNetValueBRL, isPrivate)}{" "}
                    <span className="text-emerald-600 dark:text-emerald-400">
                      (+{maskBRL(asset.maturityNetGainBRL, isPrivate)})
                    </span>
                  </span>
                </div>
              )}
          </div>
        ))}
      </div>
    </section>
  );
}
