"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Layers, Save, Target } from "lucide-react";
import {
  computeDerivedClassTargets,
  computeHierarchyForGoal,
} from "@/lib/domain/calculations";
import {
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  VARIABLE_INCOME_CLASSES,
  type GoalInput,
  type PortfolioSummary,
  formatPct,
  getAssetClassColor,
} from "@/lib/domain/types";
import { SectorGoalsSection } from "@/components/sector-goals-section";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface GoalsEditorProps {
  initialGoal: GoalInput;
  summary: PortfolioSummary;
}

interface PairConfig {
  title: string;
  leftKey: keyof GoalInput;
  rightKey: keyof GoalInput;
  leftLabel: string;
  rightLabel: string;
  leftHierarchyKey: string;
  rightHierarchyKey: string;
}

const PAIRS: PairConfig[] = [
  {
    title: "Macro",
    leftKey: "fixedIncomePct",
    rightKey: "variableIncomePct",
    leftLabel: "Renda Fixa",
    rightLabel: "Renda Variável",
    leftHierarchyKey: "FIXED_INCOME",
    rightHierarchyKey: "VARIABLE_INCOME",
  },
  {
    title: "Geografia (RV)",
    leftKey: "brazilPct",
    rightKey: "usaPct",
    leftLabel: "Brasil",
    rightLabel: "EUA",
    leftHierarchyKey: "BRAZIL",
    rightHierarchyKey: "USA",
  },
  {
    title: "Brasil",
    leftKey: "brStocksPct",
    rightKey: "brFiisPct",
    leftLabel: "Ações",
    rightLabel: "FIIs",
    leftHierarchyKey: "BR_STOCK",
    rightHierarchyKey: "BR_FII",
  },
  {
    title: "EUA",
    leftKey: "usStocksPct",
    rightKey: "usReitsPct",
    leftLabel: "Stocks",
    rightLabel: "REITs",
    leftHierarchyKey: "US_STOCK",
    rightHierarchyKey: "US_REIT",
  },
];

export function GoalsEditor({ initialGoal, summary }: GoalsEditorProps) {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [activeTab, setActiveTab] = useState<"CLASSES" | "SETORES">("CLASSES");
  const [goal, setGoal] = useState<GoalInput>(initialGoal);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = useMemo(() => computeDerivedClassTargets(goal), [goal]);
  const actualByClass = useMemo(
    () => new Map(summary.classes.map((c) => [c.assetClass, c.actualPct])),
    [summary.classes]
  );

  const hierarchyActualMap = useMemo(() => {
    const rows = computeHierarchyForGoal(goal, summary.classes);
    return new Map(rows.map((r) => [r.key, r.actualPct]));
  }, [goal, summary.classes]);

  const hasSectorIssues = useMemo(() => {
    return VARIABLE_INCOME_CLASSES.some((cls) => {
      const sectorsInCls = summary.sectors.filter(
        (s) => s.assetClass === cls && s.id !== null
      );
      const sum = sectorsInCls.reduce(
        (acc, s) => acc + (s.goalTargetPct ?? 0),
        0
      );
      const hasCoverageIssue = sectorsInCls.some(
        (s) =>
          s.status === "UNCOVERED" || s.status === "UNDER" || s.status === "OVER"
      );
      const hasSumIssue = sectorsInCls.length > 0 && Math.abs(sum - 100) > 0.05;
      return hasCoverageIssue || hasSumIssue;
    });
  }, [summary.sectors]);

  function updatePair(
    leftKey: keyof GoalInput,
    rightKey: keyof GoalInput,
    nextLeftValue: number
  ) {
    const clamped = Math.max(
      0,
      Math.min(100, Math.round(nextLeftValue * 100) / 100)
    );
    const rightVal = Math.round((100 - clamped) * 100) / 100;
    setSaved(false);
    setGoal((prev) => ({
      ...prev,
      [leftKey]: clamped,
      [rightKey]: rightVal,
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/goals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(goal),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao salvar objetivos.");
        return;
      }

      setSaved(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
          Alocação
        </h1>

        {activeTab === "CLASSES" && (
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "Salvando..." : "Salvar"}
          </button>
        )}
      </div>

      {/* Main Tabs: Classes | Setores */}
      <div className="grid w-full grid-cols-2 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:inline-flex sm:w-auto dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setActiveTab("CLASSES")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:px-4",
            activeTab === "CLASSES"
              ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Target className="h-3.5 w-3.5 shrink-0" />
          Classes
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("SETORES")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:px-4",
            activeTab === "SETORES"
              ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Layers className="h-3.5 w-3.5 shrink-0" />
          Setores
          {hasSectorIssues && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
              title="Há pendências nos setores"
            />
          )}
        </button>
      </div>

      {activeTab === "SETORES" ? (
        <SectorGoalsSection initialSummary={summary} />
      ) : (
        <>
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
              {error}
            </div>
          )}

          {saved && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Metas de alocação salvas.
            </div>
          )}

          {/* Compact Sliders Grid with Inline Actual % */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {PAIRS.map((pair) => {
              const leftVal = goal[pair.leftKey];
              const rightVal = goal[pair.rightKey];
              const leftActual =
                hierarchyActualMap.get(pair.leftHierarchyKey) ?? 0;
              const rightActual =
                hierarchyActualMap.get(pair.rightHierarchyKey) ?? 0;

              return (
                <section
                  key={pair.title}
                  className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    {pair.title}
                  </h2>

                  <div className="mt-2.5 flex items-end justify-between gap-3">
                    <div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {pair.leftLabel}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                          atual {formatPct(leftActual, 0)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={`Meta ${pair.leftLabel}`}
                          value={leftVal}
                          onChange={(e) =>
                            updatePair(
                              pair.leftKey,
                              pair.rightKey,
                              Number(e.target.value)
                            )
                          }
                          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-sm font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                          %
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                          atual {formatPct(rightActual, 0)}
                        </span>
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {pair.rightLabel}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={`Meta ${pair.rightLabel}`}
                          value={rightVal}
                          onChange={(e) =>
                            updatePair(
                              pair.leftKey,
                              pair.rightKey,
                              100 - Number(e.target.value)
                            )
                          }
                          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right font-mono text-sm font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                          %
                        </span>
                      </div>
                    </div>
                  </div>

                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={`Ajustar ${pair.title}`}
                    value={leftVal}
                    onChange={(e) =>
                      updatePair(
                        pair.leftKey,
                        pair.rightKey,
                        Number(e.target.value)
                      )
                    }
                    className="mt-3 h-2 w-full cursor-pointer accent-emerald-600"
                  />
                </section>
              );
            })}
          </div>

          {/* Unified Final Class Allocation Summary (Target vs Actual Bars) */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3.5 text-sm font-bold text-slate-900 dark:text-slate-100">
              Alocação por Classe
            </h2>

            <div className="space-y-3">
              {INVESTMENT_CLASSES.map((cls) => {
                const target = derived[cls];
                const actual = actualByClass.get(cls) ?? 0;
                const diff = actual - target;
                const maxScale = Math.max(target, actual, 1);

                return (
                  <div key={cls}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: getAssetClassColor(cls, isDark) }}
                        />
                        {ASSET_CLASS_LABELS[cls]}
                      </span>

                      <div className="flex items-center gap-2 font-mono tabular-nums">
                        <span>
                          <strong className="font-bold text-slate-900 dark:text-slate-100">
                            {formatPct(actual)}
                          </strong>{" "}
                          <span className="text-slate-400 dark:text-slate-500">
                            / {formatPct(target)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "w-12 text-right text-[11px] font-semibold",
                            diff < -0.5
                              ? "text-amber-600 dark:text-amber-400"
                              : diff > 0.5
                                ? "text-sky-600 dark:text-sky-400"
                                : "text-emerald-600 dark:text-emerald-400"
                          )}
                        >
                          {diff > 0 ? "+" : ""}
                          {formatPct(diff)}
                        </span>
                      </div>
                    </div>

                    <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(0, actual))}%`,
                          backgroundColor: getAssetClassColor(cls, isDark),
                        }}
                      />
                      {target > 0 && target <= 100 && maxScale > 0 && (
                        <span
                          title={`Meta: ${formatPct(target)}`}
                          className="absolute inset-y-0 w-0.5 bg-slate-900/75 dark:bg-white/80"
                          style={{ left: `${Math.min(99.5, target)}%` }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
