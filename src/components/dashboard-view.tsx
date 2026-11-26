"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  Compass,
  DollarSign,
  PiggyBank,
  Plus,
  RefreshCw,
  Shield,
  Wallet,
} from "lucide-react";
import { computeNextRebalanceAssets } from "@/lib/domain/calculations";
import { formatMonthShortPtBR } from "@/lib/domain/monthly-budget";
import type { SavingsSummary } from "@/lib/domain/savings";
import {
  ASSET_CLASS_LABELS,
  type PortfolioSummary,
  formatBRL,
  formatPct,
  getAssetClassColor,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import type { MonthlyBudgetHomeSummary } from "@/lib/monthly-budget-loader";
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import { maskBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface DashboardViewProps {
  initialSummary: PortfolioSummary;
  savingsSummary: SavingsSummary;
  monthlySummary: MonthlyBudgetHomeSummary;
}

export function DashboardView({
  initialSummary,
  savingsSummary,
  monthlySummary,
}: DashboardViewProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefreshQuotes() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/portfolio?refresh=1");
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        router.refresh();
      }
    } finally {
      setRefreshing(false);
    }
  }

  const nextAssets = useMemo(
    () => computeNextRebalanceAssets(summary, 3),
    [summary]
  );

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

  const activeBudget = monthlySummary.budget;
  const reserveGoal = savingsSummary.emergencyReserveGoal;
  const hasLegacyReserve = summary.emergencyReserveBRL > 0.005;

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            Início
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

      {/* TOP GRID: PILLAR 1 (HOJE) + PILLAR 2 (AMANHÃ) — strictly separated */}
      <div className="grid gap-3.5 lg:grid-cols-2">
        {/* PILLAR 1: HOJE — CONTROLE DO MÊS */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                <CalendarCheck2 className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold tracking-wider text-amber-700 uppercase dark:text-amber-400">
                    Hoje
                  </span>
                  <span className="text-[11px] text-slate-400">·</span>
                  <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {activeBudget
                      ? activeBudget.labelShort
                      : formatMonthShortPtBR(
                          monthlySummary.currentYear,
                          monthlySummary.currentMonth
                        )}
                  </h2>
                </div>
              </div>
            </div>

            <Link
              href="/mes"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              Abrir mês
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {activeBudget ? (
            <div className="mt-3.5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Dinheiro real
                </p>
                <p className="mt-0.5 truncate font-mono text-sm font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {maskBRL(activeBudget.totals.realAvailableCashBRL, isPrivate)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Falta pagar
                </p>
                <p className="mt-0.5 truncate font-mono text-sm font-bold text-rose-600 tabular-nums dark:text-rose-400">
                  {maskBRL(activeBudget.totals.pendingExpensesBRL, isPrivate)}
                </p>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Sobra final
                </p>
                <p
                  className={cn(
                    "mt-0.5 truncate font-mono text-sm font-bold tabular-nums",
                    activeBudget.totals.finalSurplusBRL < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-700 dark:text-emerald-400"
                  )}
                >
                  {maskBRL(activeBudget.totals.finalSurplusBRL, isPrivate)}
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span>Nenhum controle mensal iniciado ainda.</span>
              <Link
                href="/mes"
                className="shrink-0 font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                Iniciar →
              </Link>
            </div>
          )}
        </section>

        {/* PILLAR 2: AMANHÃ — CAIXINHAS */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400">
                <PiggyBank className="h-4 w-4" />
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold tracking-wider text-teal-700 uppercase dark:text-teal-400">
                  Amanhã
                </span>
                <span className="text-[11px] text-slate-400">·</span>
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Caixinhas
                </h2>
              </div>
            </div>

            <Link
              href="/caixinhas"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              Ver caixinhas
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {savingsSummary.activeGoals.length > 0 ? (
            <div className="mt-3.5 space-y-2.5 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Total guardado ({savingsSummary.activeGoals.length} ativas)
                  </p>
                  <p className="mt-0.5 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                    {maskBRL(savingsSummary.totalActiveBalanceBRL, isPrivate)}
                  </p>
                </div>

                {savingsSummary.totalRequiredMonthlyBRL > 0 && (
                  <div className="text-right">
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Meta / mês
                    </p>
                    <p className="mt-0.5 font-mono text-xs font-bold text-teal-700 tabular-nums dark:text-teal-400">
                      {maskBRL(savingsSummary.totalRequiredMonthlyBRL, isPrivate)}
                    </p>
                  </div>
                )}
              </div>

              {reserveGoal && reserveGoal.targetAmount !== null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Shield className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                      {reserveGoal.name}
                    </span>
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {formatPct(reserveGoal.progressPct ?? 0, 0)} (
                      {maskBRL(reserveGoal.currentBalanceBRL, isPrivate)})
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-teal-500"
                      style={{ width: `${reserveGoal.progressPct ?? 0}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <span>Nenhuma caixinha criada ainda.</span>
              <Link
                href="/caixinhas"
                className="shrink-0 font-semibold text-teal-700 hover:underline dark:text-teal-400"
              >
                Criar →
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* PILLAR 3: LONGO PRAZO — CARTEIRA */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-700 uppercase dark:bg-emerald-950/60 dark:text-emerald-300">
              Longo Prazo
            </span>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Carteira de Investimentos
            </h2>
          </div>

          <Link
            href="/carteira"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Carteira
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <CompactKpiStrip
          columns={3}
          items={[
            {
              id: "invested",
              label: "Investido (Longo Prazo)",
              value: maskBRL(summary.totalInvestedValueBRL, isPrivate),
              icon: (
                <Wallet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ),
              highlighted: !hasLegacyReserve,
            },
            {
              id: "reserve",
              label: hasLegacyReserve ? "Reserva (Carteira)" : "Classes ativas",
              value: hasLegacyReserve
                ? maskBRL(summary.emergencyReserveBRL, isPrivate)
                : String(
                    summary.classes.filter((c) => c.currentValueBRL > 0).length
                  ),
              icon: (
                <Shield className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              ),
            },
            {
              id: "grand-total",
              label: hasLegacyReserve ? "Total + Reserva" : "Ativos na carteira",
              value: hasLegacyReserve
                ? maskBRL(summary.grandTotalBRL, isPrivate)
                : String(summary.assets.filter((a) => a.isActive).length),
              icon: (
                <DollarSign className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ),
              highlighted: hasLegacyReserve,
              mobileFullRow: true,
            },
          ]}
        />

        {/* Next 3 Assets to Rebalance */}
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Compass className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Próximos para balancear
              </h3>
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
      </div>
    </div>
  );
}
