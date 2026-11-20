"use client";

import { useMemo, useState } from "react";
import { Check, CheckCircle2, Compass, PlusCircle } from "lucide-react";
import { computeContributionPlan } from "@/lib/domain/calculations";
import {
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  type ContributionSuggestion,
  type InvestmentClassKey,
  type PortfolioSummary,
  formatBRL,
  formatUSD,
  formatQty,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

interface ContributionPlannerProps {
  initialSummary: PortfolioSummary;
}

export function ContributionPlanner({
  initialSummary,
}: ContributionPlannerProps) {
  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [amountInput, setAmountInput] = useState("1000");
  const [maxAssets, setMaxAssets] = useState(3);
  const [ignoredClasses, setIgnoredClasses] = useState<InvestmentClassKey[]>(
    []
  );
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [recordedIds, setRecordedIds] = useState<string[]>([]);

  const amountBRL = Math.max(0, Number(amountInput.replace(",", ".")) || 0);

  const plan = useMemo(() => {
    return computeContributionPlan({
      summary,
      amountBRL,
      maxAssets,
      ignoredClasses,
    });
  }, [summary, amountBRL, maxAssets, ignoredClasses]);

  function toggleIgnoreClass(cls: InvestmentClassKey) {
    setIgnoredClasses((prev) =>
      prev.includes(cls) ? prev.filter((c) => c !== cls) : [...prev, cls]
    );
  }

  async function handleRecordContribution(s: ContributionSuggestion) {
    if (s.suggestedQty <= 0 || s.investBRL <= 0) return;
    setRecordingId(s.assetId);

    try {
      const totalInCurrency =
        s.currency === "USD" ? s.investUSD : s.investBRL;
      const unitInCurrency = s.unitPriceNative;

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: s.assetId,
          date: new Date().toISOString().slice(0, 10),
          type: "BUY",
          quantity: s.suggestedQty,
          unitPrice: unitInCurrency,
          totalAmount: totalInCurrency,
          notes: "Aporte via Plano de Aporte",
        }),
      });

      if (res.ok) {
        setRecordedIds((prev) => [...prev, s.assetId]);
        const portRes = await fetch("/api/portfolio");
        if (portRes.ok) {
          const data = await portRes.json();
          setSummary(data.summary);
        }
      }
    } finally {
      setRecordingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Plano de Aporte
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Sugestão automática dos ativos mais distantes do objetivo, respeitando
          lotes inteiros na B3 e frações (mín. US$ 5) nos EUA.
        </p>
      </div>

      {/* Controls */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Quanto você quer investir (R$)
            </label>
            <input
              type="number"
              min="0"
              step="50"
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setRecordedIds([]);
              }}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 font-mono text-lg font-bold text-slate-900 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Quantidade máxima de ativos ({maxAssets})
            </label>
            <div className="flex items-center gap-3 pt-1">
              <input
                type="range"
                min={1}
                max={10}
                value={maxAssets}
                onChange={(e) => setMaxAssets(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer accent-emerald-600"
              />
              <span className="w-10 rounded-lg bg-slate-100 py-1 text-center font-mono text-sm font-bold text-slate-900">
                {maxAssets}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="mb-2 text-xs font-semibold text-slate-500">
            Ignorar classes neste aporte (opcional):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {INVESTMENT_CLASSES.map((cls) => {
              const ignored = ignoredClasses.includes(cls);
              return (
                <button
                  key={cls}
                  type="button"
                  onClick={() => toggleIgnoreClass(cls)}
                  className={cn(
                    "rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
                    ignored
                      ? "border-rose-200 bg-rose-50 text-rose-700 line-through"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {ASSET_CLASS_LABELS[cls]}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Total Alocado</p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
            {formatBRL(plan.totalAllocatedBRL)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">
            Sobra não alocada
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-700 tabular-nums">
            {formatBRL(plan.remainingBRL)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs">
          <p className="text-xs font-medium text-slate-500">Câmbio usado</p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {formatBRL(plan.usdBrl)}
          </p>
        </div>
      </div>

      {/* Suggestions */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Compass className="h-4 w-4 text-emerald-600" />
          <h2 className="text-base font-bold text-slate-900">
            Sugestão de Compras
          </h2>
        </div>

        {plan.suggestions.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            Informe um valor para calcular as sugestões de aporte ou verifique se
            há ativos ativos com objetivos definidos.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {plan.suggestions.map((s) => {
              const isRecorded = recordedIds.includes(s.assetId);
              const isRecording = recordingId === s.assetId;
              return (
                <div
                  key={s.assetId}
                  className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-slate-900">
                        {s.ticker}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {ASSET_CLASS_LABELS[s.assetClass]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Falta para meta:{" "}
                      <span className="font-mono font-semibold text-slate-700 tabular-nums">
                        {formatBRL(s.neededBRL)}
                      </span>{" "}
                      · Cotação:{" "}
                      <span className="font-mono tabular-nums">
                        {formatBRL(s.unitPriceBRL)}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 sm:justify-end">
                    <div className="text-left sm:text-right">
                      <p className="font-mono text-base font-bold text-emerald-700 tabular-nums">
                        {formatBRL(s.investBRL)}
                      </p>
                      <p className="font-mono text-xs text-slate-500 tabular-nums">
                        {formatQty(s.suggestedQty, s.assetClass)}{" "}
                        {s.assetClass === "FIXED_INCOME" ? "reais" : "unid."}
                        {s.currency === "USD" && (
                          <span className="ml-1.5 text-slate-400">
                            ({formatUSD(s.investUSD)})
                          </span>
                        )}
                      </p>
                    </div>

                    {s.investBRL > 0 && (
                      <button
                        type="button"
                        disabled={isRecording || isRecorded}
                        onClick={() => handleRecordContribution(s)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors",
                          isRecorded
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                        )}
                      >
                        {isRecorded ? (
                          <>
                            <CheckCircle2 className="h-4 w-4" />
                            Registrado
                          </>
                        ) : isRecording ? (
                          "Salvando..."
                        ) : (
                          <>
                            <PlusCircle className="h-4 w-4" />
                            Registrar compra
                          </>
                        )}
                      </button>
                    )}
                    {s.investBRL === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500">
                        <Check className="h-3.5 w-3.5" />
                        Saldo insuficiente p/ 1 cota
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
