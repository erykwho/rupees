"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  Compass,
  PlusCircle,
  SlidersHorizontal,
} from "lucide-react";
import { computeContributionPlan } from "@/lib/domain/calculations";
import {
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  type ContributionSuggestion,
  type InvestmentClassKey,
  type PortfolioSummary,
  formatBRL,
} from "@/lib/domain/types";
import { usePrivacy } from "@/components/privacy-provider";
import { maskBRL, maskQty, maskUSD } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface ContributionPlannerProps {
  initialSummary: PortfolioSummary;
}

export function ContributionPlanner({
  initialSummary,
}: ContributionPlannerProps) {
  const { isPrivate } = usePrivacy();
  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [amountInput, setAmountInput] = useState("1000");
  const [maxAssets, setMaxAssets] = useState(3);
  const [ignoredClasses, setIgnoredClasses] = useState<InvestmentClassKey[]>(
    []
  );
  const [optionsOpen, setOptionsOpen] = useState(false);
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

  const hasCustomOptions = maxAssets !== 3 || ignoredClasses.length > 0;

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
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
          Plano de Aporte
        </h1>
      </div>

      {/* Prominent Amount Input + Collapsible Options */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-end gap-2.5">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="contribution-amount"
              className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400"
            >
              Valor do aporte (R$)
            </label>
            <input
              id="contribution-amount"
              type="number"
              min="0"
              step="50"
              value={amountInput}
              onChange={(e) => {
                setAmountInput(e.target.value);
                setRecordedIds([]);
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2 font-mono text-lg font-bold text-slate-900 focus:border-emerald-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
            />
          </div>

          <button
            type="button"
            onClick={() => setOptionsOpen((prev) => !prev)}
            aria-expanded={optionsOpen}
            className={cn(
              "inline-flex h-[46px] shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
              optionsOpen || hasCustomOptions
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Opções</span>
            {hasCustomOptions && (
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            )}
          </button>
        </div>

        {/* Collapsible Options Panel */}
        {optionsOpen && (
          <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-600 dark:text-slate-300">
                  Máximo de ativos
                </span>
                <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                  {maxAssets}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={maxAssets}
                onChange={(e) => setMaxAssets(Number(e.target.value))}
                aria-label="Quantidade máxima de ativos"
                className="h-2 w-full cursor-pointer accent-emerald-600"
              />
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Ignorar classes
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
                        "rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                        ignored
                          ? "border-rose-200 bg-rose-50 text-rose-700 line-through dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      )}
                    >
                      {ASSET_CLASS_LABELS[cls]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Compact 2-Column Summary Strip */}
      <div className="grid grid-cols-2 divide-x divide-slate-200/70 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        <div className="px-4 py-2.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Alocado
          </p>
          <p className="mt-0.5 font-mono text-base font-bold text-emerald-700 tabular-nums sm:text-lg dark:text-emerald-400">
            {maskBRL(plan.totalAllocatedBRL, isPrivate)}
          </p>
        </div>
        <div className="px-4 py-2.5">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Sobra
          </p>
          <p className="mt-0.5 font-mono text-base font-bold text-slate-700 tabular-nums sm:text-lg dark:text-slate-200">
            {maskBRL(plan.remainingBRL, isPrivate)}
          </p>
        </div>
      </div>

      {/* Suggestions */}
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Sugestão de Compras
            </h2>
          </div>
          <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
            {maxAssets} {maxAssets === 1 ? "ativo" : "ativos"}
            {ignoredClasses.length > 0 &&
              ` · -${ignoredClasses.length} ${ignoredClasses.length === 1 ? "classe" : "classes"}`}
          </span>
        </div>

        {plan.suggestions.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
            Informe um valor para calcular as sugestões.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {plan.suggestions.map((s) => {
              const isRecorded = recordedIds.includes(s.assetId);
              const isRecording = recordingId === s.assetId;
              return (
                <div
                  key={s.assetId}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100">
                        {s.ticker}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: ASSET_CLASS_COLORS[s.assetClass],
                          }}
                        />
                        {ASSET_CLASS_LABELS[s.assetClass]}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                      {maskQty(s.suggestedQty, isPrivate, s.assetClass)}{" "}
                      {s.assetClass === "FIXED_INCOME" ? "reais" : "unid."}
                      {s.assetClass !== "FIXED_INCOME" &&
                        ` · ${formatBRL(s.unitPriceBRL)}`}
                      {s.currency === "USD" && (
                        <span className="ml-1 text-slate-400 dark:text-slate-500">
                          ({maskUSD(s.investUSD, isPrivate)})
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2.5">
                    {s.investBRL > 0 ? (
                      <>
                        <span className="font-mono text-sm font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                          {maskBRL(s.investBRL, isPrivate)}
                        </span>
                        <button
                          type="button"
                          disabled={isRecording || isRecorded}
                          onClick={() => handleRecordContribution(s)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                            isRecorded
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                              : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                          )}
                        >
                          {isRecorded ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              OK
                            </>
                          ) : isRecording ? (
                            "..."
                          ) : (
                            <>
                              <PlusCircle className="h-3.5 w-3.5" />
                              Registrar
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        <Check className="h-3 w-3" />
                        &lt; 1 cota
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
