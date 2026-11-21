"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Compass,
  DollarSign,
  Plus,
  RefreshCw,
  Shield,
  Target,
  Wallet,
} from "lucide-react";
import { computeNextRebalanceAssets } from "@/lib/domain/calculations";
import {
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  type PortfolioSummary,
  formatBRL,
  formatPct,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import { usePrivacy } from "@/components/privacy-provider";
import { maskBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface DashboardViewProps {
  initialSummary: PortfolioSummary;
}

export function DashboardView({ initialSummary }: DashboardViewProps) {
  const { isPrivate } = usePrivacy();

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [refreshing, setRefreshing] = useState(false);

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

  const macroRows = useMemo(
    () => summary.hierarchy.filter((r) => r.group === "MACRO"),
    [summary.hierarchy]
  );

  const regionRows = useMemo(
    () => summary.hierarchy.filter((r) => r.group === "REGION"),
    [summary.hierarchy]
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Patrimônio Investido</span>
            <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {maskBRL(summary.totalInvestedValueBRL, isPrivate)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Carteira de longo prazo
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

      {/* Next 3 Assets to Rebalance */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
          <div className="flex items-start gap-2.5">
            <Compass className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Próximos ativos para balancear
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Top 3 mais distantes da meta, priorizando classes defasadas
              </p>
            </div>
          </div>
          <Link
            href="/aporte"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Simular no Plano de Aporte
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {nextAssets.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            Sua carteira está alinhada com os objetivos atuais.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {nextAssets.map((asset, index) => (
              <div
                key={asset.id}
                className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-slate-50/70 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-slate-800/40"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-mono text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                    {index + 1}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                        {asset.ticker}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              ASSET_CLASS_COLORS[asset.assetClass],
                          }}
                        />
                        {ASSET_CLASS_LABELS[asset.assetClass]}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      Atual{" "}
                      <span className="font-mono font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                        {formatPct(asset.actualPct)}
                      </span>{" "}
                      · Alvo{" "}
                      <span className="font-mono tabular-nums">
                        {formatPct(asset.globalTargetPct)}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="pl-10 sm:pl-0 sm:text-right">
                  <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                    Falta para a meta
                  </p>
                  <p className="font-mono text-base font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                    {maskBRL(asset.balanceNeededBRL, isPrivate)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Macro Goals Summary */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Objetivos Macros
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Estratégia atual configurada para sua carteira
              </p>
            </div>
          </div>

          <Link
            href="/objetivos"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Quer ajustar sua estratégia? Alterar objetivos
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Level 1: Renda Fixa vs Renda Variável */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Alocação Macro
            </p>
            <div className="mt-3 space-y-3">
              {macroRows.map((row) => (
                <div key={row.key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {row.label}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <strong className="font-bold text-slate-900 dark:text-slate-100">
                        {formatPct(row.actualPct)}
                      </strong>{" "}
                      <span className="text-slate-400 dark:text-slate-500">
                        / alvo {formatPct(row.targetPct, 0)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all dark:bg-emerald-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, row.actualPct))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Level 2: Brasil vs EUA (dentro de RV) */}
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              Geografia (dentro de Renda Variável)
            </p>
            <div className="mt-3 space-y-3">
              {regionRows.map((row) => (
                <div key={row.key}>
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {row.label}
                    </span>
                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      <strong className="font-bold text-slate-900 dark:text-slate-100">
                        {formatPct(row.actualPct)}
                      </strong>{" "}
                      <span className="text-slate-400 dark:text-slate-500">
                        / alvo {formatPct(row.targetPct, 0)}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-700/70">
                    <div
                      className="h-full rounded-full bg-sky-600 transition-all dark:bg-sky-500"
                      style={{
                        width: `${Math.min(100, Math.max(0, row.actualPct))}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
