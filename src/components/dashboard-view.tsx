"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Compass,
  DollarSign,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Shield,
  Wallet,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  computeClassDistribution,
  computeNextRebalanceAssets,
} from "@/lib/domain/calculations";
import {
  ASSET_CLASS_LABELS,
  type AssetClassKey,
  type PortfolioSummary,
  formatBRL,
  formatPct,
  getAssetClassColor,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import { maskBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface DashboardViewProps {
  initialSummary: PortfolioSummary;
}

export function DashboardView({ initialSummary }: DashboardViewProps) {
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [refreshing, setRefreshing] = useState(false);
  // Default to invested portfolio only so actual % aligns with target %
  const [showReserveInChart, setShowReserveInChart] = useState(false);

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

  const nextAssets = useMemo(
    () => computeNextRebalanceAssets(summary, 3),
    [summary]
  );

  const classDistribution = useMemo(
    () => computeClassDistribution(summary, showReserveInChart),
    [summary, showReserveInChart]
  );

  const targetByClass = useMemo(() => {
    const map = new Map<AssetClassKey, number>();
    for (const cls of summary.classes) {
      map.set(cls.assetClass, cls.targetPct);
    }
    return map;
  }, [summary.classes]);

  const tooltipContentStyle = isDark
    ? {
        borderRadius: "12px",
        border: "1px solid #35312c",
        backgroundColor: "#211f1c",
        color: "#e6e2da",
        fontSize: "12px",
      }
    : {
        borderRadius: "12px",
        border: "1px solid #e2e8f0",
        backgroundColor: "#ffffff",
        color: "#0f172a",
        fontSize: "12px",
      };

  const tickerValidationIssues = useMemo(
    () =>
      summary.assets.filter(
        (a) =>
          isVariableIncomeClass(a.assetClass) &&
          a.tickerValidationStatus !== "VERIFIED"
      ),
    [summary.assets]
  );

  const usdTooltip = summary.usdBrlUpdatedAt
    ? `Dólar atualizado às ${new Date(
        summary.usdBrlUpdatedAt
      ).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "Cotação atual do dólar";

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            Visão Geral
          </h1>
          <span
            title={usdTooltip}
            className="hidden shrink-0 font-mono text-xs text-slate-400 tabular-nums sm:inline dark:text-slate-500"
          >
            USD {formatBRL(summary.usdBrl)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <span
            title={usdTooltip}
            className="mr-0.5 font-mono text-[11px] text-slate-400 tabular-nums sm:hidden dark:text-slate-500"
          >
            USD {formatBRL(summary.usdBrl)}
          </span>
          <button
            type="button"
            onClick={handleRefreshQuotes}
            disabled={refreshing}
            title="Atualizar cotações"
            aria-label="Atualizar cotações"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
            />
          </button>

          <Link
            href="/lancamentos?novo=1"
            className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Lançamento</span>
          </Link>
        </div>
      </div>

      {/* Compact Ticker Validation Alert */}
      {tickerValidationIssues.length > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3.5 py-2.5 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="truncate">
              Ticker pendente/inválido:{" "}
              <strong className="font-mono">
                {tickerValidationIssues.map((a) => a.ticker).join(", ")}
              </strong>
            </span>
          </div>
          <Link
            href="/carteira"
            className="inline-flex shrink-0 items-center gap-1 font-semibold text-rose-700 hover:underline dark:text-rose-300"
          >
            Revisar
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* KPI Strip */}
      <CompactKpiStrip
        columns={3}
        items={[
          {
            id: "invested",
            label: "Investido",
            value: maskBRL(summary.totalInvestedValueBRL, isPrivate),
            icon: (
              <Wallet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
          },
          {
            id: "reserve",
            label: "Reserva",
            value: maskBRL(summary.emergencyReserveBRL, isPrivate),
            icon: (
              <Shield className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            ),
          },
          {
            id: "grand-total",
            label: "Total + Reserva",
            value: maskBRL(summary.grandTotalBRL, isPrivate),
            icon: (
              <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            highlighted: true,
            mobileFullRow: true,
          },
        ]}
      />

      {/* Primary Dashboard Grid: Rebalance Top 3 + Class Distribution */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        {/* Next 3 Assets to Rebalance */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Próximos para balancear
              </h2>
            </div>
            <Link
              href="/aporte"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              Aporte
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {nextAssets.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Carteira alinhada com as metas.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {nextAssets.map((asset, index) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-mono text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                          {asset.ticker}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{
                              backgroundColor: getAssetClassColor(
                                asset.assetClass,
                                isDark
                              ),
                            }}
                          />
                          {ASSET_CLASS_LABELS[asset.assetClass]}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                        {formatPct(asset.actualPct)}{" "}
                        <span className="text-slate-400 dark:text-slate-500">
                          / alvo {formatPct(asset.globalTargetPct)}
                        </span>
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 font-mono text-sm font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                    +{maskBRL(asset.balanceNeededBRL, isPrivate)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Class Distribution Pie Chart */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Distribuição por Classe
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowReserveInChart((prev) => !prev)}
                aria-pressed={showReserveInChart}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors",
                  showReserveInChart
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
                )}
              >
                <Shield className="h-3 w-3" />
                Reserva
              </button>
              <Link
                href="/objetivos"
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                Metas
              </Link>
            </div>
          </div>

          {classDistribution.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
              Nenhum valor investido para exibir.
            </div>
          ) : (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={classDistribution}
                      dataKey="valueBRL"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={76}
                      paddingAngle={2}
                      stroke={isDark ? "#211f1c" : "#ffffff"}
                    >
                      {classDistribution.map((entry) => (
                        <Cell
                          key={entry.assetClass}
                          fill={getAssetClassColor(entry.assetClass, isDark)}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => maskBRL(Number(value), isPrivate)}
                      contentStyle={tooltipContentStyle}
                      itemStyle={{ color: isDark ? "#e6e2da" : "#0f172a" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="space-y-2">
                {classDistribution.map((item) => {
                  const targetPct = !showReserveInChart
                    ? targetByClass.get(item.assetClass)
                    : undefined;
                  return (
                    <div
                      key={item.assetClass}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            backgroundColor: getAssetClassColor(
                              item.assetClass,
                              isDark
                            ),
                          }}
                        />
                        <span className="truncate font-medium">
                          {item.label}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono tabular-nums">
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">
                          {formatPct(item.pct)}
                        </strong>
                        {targetPct !== undefined && (
                          <span className="ml-1 text-[11px] text-slate-400 dark:text-slate-500">
                            / {formatPct(targetPct, 0)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
