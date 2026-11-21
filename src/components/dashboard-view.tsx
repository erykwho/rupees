"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Compass,
  DollarSign,
  Plus,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  type InvestmentClassKey,
  type PortfolioSummary,
  formatBRL,
  formatPct,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import { maskBRL, maskSignedBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

const SECTOR_PALETTE = [
  "#059669",
  "#0284c7",
  "#2563eb",
  "#d97706",
  "#0f766e",
  "#4f46e5",
  "#db2777",
  "#65a30d",
  "#0891b2",
  "#ea580c",
  "#64748b",
  "#10b981",
];

interface DashboardViewProps {
  initialSummary: PortfolioSummary;
}

export function DashboardView({ initialSummary }: DashboardViewProps) {
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSectorClass, setSelectedSectorClass] =
    useState<InvestmentClassKey>("BR_STOCK");

  async function handleRefreshQuotes() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/portfolio?refresh=1");
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
      }
    } finally {
      setRefreshing(false);
    }
  }

  const classChartData = summary.classes.map((c) => ({
    name: c.label,
    Objetivo: Number(c.targetPct.toFixed(1)),
    Real: Number(c.actualPct.toFixed(1)),
    color: ASSET_CLASS_COLORS[c.assetClass],
  }));

  const sectorData = summary.sectors
    .filter(
      (s) => s.assetClass === selectedSectorClass && s.currentValueBRL > 0
    )
    .map((s) => ({
      name: s.sector,
      value: Number(s.currentValueBRL.toFixed(2)),
      pct: Number(s.actualPctInClass.toFixed(1)),
    }));

  const tickerValidationIssues = summary.assets.filter(
    (a) =>
      isVariableIncomeClass(a.assetClass) &&
      a.tickerValidationStatus !== "VERIFIED"
  );

  const isPositiveReturn = summary.totalProfitLossBRL >= 0;

  const tooltipContentStyle = isDark
    ? {
        borderRadius: "12px",
        border: "1px solid #1e293b",
        backgroundColor: "#0f172a",
        color: "#f1f5f9",
        fontSize: "12px",
      }
    : {
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        backgroundColor: "#ffffff",
        color: "#0f172a",
        fontSize: "12px",
      };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Visão Geral
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Dólar atual:{" "}
            <span className="font-mono font-semibold text-slate-700 tabular-nums dark:text-slate-200">
              {formatBRL(summary.usdBrl)}
            </span>
            {summary.usdBrlUpdatedAt && (
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                · atualizado{" "}
                {new Date(summary.usdBrlUpdatedAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRefreshQuotes}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
            {refreshing ? "Atualizando..." : "Atualizar cotações"}
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

      {/* Compact Ticker Validation Alert */}
      {tickerValidationIssues.length > 0 && (
        <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-xs text-rose-900 sm:flex-row sm:items-center sm:justify-between dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-start gap-2 sm:items-center">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 sm:mt-0 dark:text-rose-400" />
            <span>
              <strong>
                {tickerValidationIssues.length}{" "}
                {tickerValidationIssues.length === 1 ? "ativo" : "ativos"}
              </strong>{" "}
              com inconsistência de ticker no Yahoo Finance:{" "}
              <span className="font-mono font-semibold">
                {tickerValidationIssues.map((a) => a.ticker).join(", ")}
              </span>
              .
            </span>
          </div>
          <Link
            href="/carteira"
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-rose-700 hover:underline dark:text-rose-300"
          >
            Revisar na Carteira
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Patrimônio Investido</span>
            <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {maskBRL(summary.totalInvestedValueBRL, isPrivate)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Custo aplicado:{" "}
            <span className="font-mono tabular-nums">
              {maskBRL(summary.totalCostBasisBRL, isPrivate)}
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Resultado Estimado</span>
            {isPositiveReturn ? (
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <TrendingDown className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            )}
          </div>
          <p
            className={cn(
              "mt-2 font-mono text-2xl font-bold tracking-tight tabular-nums",
              isPositiveReturn
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            )}
          >
            {maskSignedBRL(summary.totalProfitLossBRL, isPrivate)}
          </p>
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Rentabilidade:{" "}
            <span
              className={cn(
                "font-mono font-semibold tabular-nums",
                isPositiveReturn
                  ? "text-emerald-700 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              )}
            >
              {isPositiveReturn ? "+" : ""}
              {formatPct(summary.totalProfitLossPct, 2)}
            </span>
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Reserva de Emergência</span>
            <Shield className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {maskBRL(summary.emergencyReserveBRL, isPrivate)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Separada do balanceamento
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total + Reserva</span>
            <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {maskBRL(summary.grandTotalBRL, isPrivate)}
          </p>
          <Link
            href="/aporte"
            className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            <Compass className="h-3.5 w-3.5" />
            Simular próximo aporte
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Allocation Table by Class */}
      <section className="rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Alocação por Classe
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Comparação entre objetivo definido e carteira atual
            </p>
          </div>
          <Link
            href="/objetivos"
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Alterar objetivos
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="px-5 py-3">Classe</th>
                <th className="px-4 py-3 text-right">Objetivo</th>
                <th className="px-4 py-3 text-right">Real</th>
                <th className="px-4 py-3 text-right">Diff</th>
                <th className="px-4 py-3 text-right">Investido</th>
                <th className="px-5 py-3 text-right">Balancear</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {summary.classes.map((c) => {
                const underTarget = c.balanceNeededBRL > 0;
                return (
                  <tr
                    key={c.assetClass}
                    className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-5 py-3.5 font-semibold text-slate-900 dark:text-slate-100">
                      <span className="inline-flex items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor: ASSET_CLASS_COLORS[c.assetClass],
                          }}
                        />
                        {c.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                      {formatPct(c.targetPct)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatPct(c.actualPct)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                      <span
                        className={cn(
                          "inline-flex rounded-md px-2 py-0.5 text-xs font-semibold",
                          c.diffPct < -0.5
                            ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                            : c.diffPct > 0.5
                              ? "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                        )}
                      >
                        {c.diffPct > 0 ? "+" : ""}
                        {formatPct(c.diffPct)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-right font-mono text-slate-800 tabular-nums dark:text-slate-200">
                      {maskBRL(c.currentValueBRL, isPrivate)}
                    </td>
                    <td
                      className={cn(
                        "px-5 py-3.5 text-right font-mono font-semibold tabular-nums",
                        underTarget
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-slate-400 dark:text-slate-500"
                      )}
                    >
                      {isPrivate
                        ? maskBRL(c.balanceNeededBRL, true)
                        : `${underTarget ? "+" : ""}${formatBRL(c.balanceNeededBRL)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Real vs Objetivo Bar Chart */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Objetivo vs Real (%)
          </h2>
          <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
            Distribuição percentual por classe de ativos
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={classChartData}
                margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={isDark ? "#1e293b" : "#f1f5f9"}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 12, fill: isDark ? "#94a3b8" : "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: isDark ? "#64748b" : "#94a3b8" }}
                  axisLine={false}
                  tickLine={false}
                  unit="%"
                />
                <Tooltip
                  formatter={(value) => [`${value}%`, ""]}
                  contentStyle={tooltipContentStyle}
                  itemStyle={{ color: isDark ? "#e2e8f0" : "#0f172a" }}
                  labelStyle={{ color: isDark ? "#f8fafc" : "#0f172a" }}
                  cursor={{
                    fill: isDark
                      ? "rgba(30, 41, 59, 0.5)"
                      : "rgba(241, 245, 249, 0.7)",
                  }}
                />
                <Bar
                  dataKey="Objetivo"
                  fill={isDark ? "#475569" : "#cbd5e1"}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="Real"
                  fill={isDark ? "#10b981" : "#059669"}
                  radius={[6, 6, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Sector Allocation Chart */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Alocação por Setor
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Concentração setorial dentro da classe
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {INVESTMENT_CLASSES.filter((c) => c !== "FIXED_INCOME").map(
                (cls) => (
                  <button
                    key={cls}
                    type="button"
                    onClick={() => setSelectedSectorClass(cls)}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                      selectedSectorClass === cls
                        ? "bg-emerald-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                    )}
                  >
                    {ASSET_CLASS_LABELS[cls]}
                  </button>
                )
              )}
            </div>
          </div>

          {sectorData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Nenhum valor investido nesta classe ainda.
            </div>
          ) : (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sectorData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={82}
                      paddingAngle={2}
                      stroke={isDark ? "#0f172a" : "#ffffff"}
                    >
                      {sectorData.map((entry, idx) => (
                        <Cell
                          key={entry.name}
                          fill={SECTOR_PALETTE[idx % SECTOR_PALETTE.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => maskBRL(Number(value), isPrivate)}
                      contentStyle={tooltipContentStyle}
                      itemStyle={{ color: isDark ? "#e2e8f0" : "#0f172a" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {sectorData.map((s, idx) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor:
                            SECTOR_PALETTE[idx % SECTOR_PALETTE.length],
                        }}
                      />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="shrink-0 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                      {formatPct(s.pct)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Hierarchy Breakdown */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Hierarquia dos Objetivos
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Macro (RF/RV), Geografia (Brasil/EUA) e Subclasses
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summary.hierarchy.map((row) => (
            <div
              key={row.key}
              className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
            >
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                {row.label}
              </p>
              <div className="mt-1.5 flex items-baseline justify-between">
                <span className="font-mono text-lg font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatPct(row.actualPct)}
                </span>
                <span className="font-mono text-xs text-slate-400 tabular-nums dark:text-slate-500">
                  alvo {formatPct(row.targetPct, 0)}
                </span>
              </div>
              <p
                className={cn(
                  "mt-1 font-mono text-xs font-semibold tabular-nums",
                  row.diffPct < -1
                    ? "text-amber-600 dark:text-amber-400"
                    : row.diffPct > 1
                      ? "text-sky-600 dark:text-sky-400"
                      : "text-emerald-600 dark:text-emerald-400"
                )}
              >
                {row.diffPct > 0 ? "+" : ""}
                {formatPct(row.diffPct)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
