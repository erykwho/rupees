"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Save } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  computeDerivedClassTargets,
  computeHierarchyForGoal,
} from "@/lib/domain/calculations";
import {
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  type GoalInput,
  type PortfolioSummary,
  formatPct,
} from "@/lib/domain/types";
import { useTheme } from "@/components/theme-provider";
import { SectorGoalsSection } from "@/components/sector-goals-section";
import { cn } from "@/lib/utils";

interface GoalsEditorProps {
  initialGoal: GoalInput;
  summary: PortfolioSummary;
}

interface PairConfig {
  title: string;
  subtitle: string;
  leftKey: keyof GoalInput;
  rightKey: keyof GoalInput;
  leftLabel: string;
  rightLabel: string;
}

const PAIRS: PairConfig[] = [
  {
    title: "Alocação Macro",
    subtitle: "Divisão principal da carteira de investimentos (Reserva fica separada)",
    leftKey: "fixedIncomePct",
    rightKey: "variableIncomePct",
    leftLabel: "Renda Fixa",
    rightLabel: "Renda Variável",
  },
  {
    title: "Geografia (dentro de Renda Variável)",
    subtitle: "Exposição entre mercado brasileiro e americano",
    leftKey: "brazilPct",
    rightKey: "usaPct",
    leftLabel: "Brasil",
    rightLabel: "EUA",
  },
  {
    title: "Brasil (dentro de RV Brasil)",
    subtitle: "Equilíbrio entre Ações e Fundos Imobiliários",
    leftKey: "brStocksPct",
    rightKey: "brFiisPct",
    leftLabel: "Ações",
    rightLabel: "FIIs",
  },
  {
    title: "EUA (dentro de RV EUA)",
    subtitle: "Equilíbrio entre Stocks/ETFs e REITs",
    leftKey: "usStocksPct",
    rightKey: "usReitsPct",
    leftLabel: "Stocks",
    rightLabel: "REITs",
  },
];

export function GoalsEditor({ initialGoal, summary }: GoalsEditorProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [goal, setGoal] = useState<GoalInput>(initialGoal);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derived = useMemo(() => computeDerivedClassTargets(goal), [goal]);
  const actualByClass = useMemo(
    () => new Map(summary.classes.map((c) => [c.assetClass, c.actualPct])),
    [summary.classes]
  );

  const classChartData = useMemo(
    () =>
      INVESTMENT_CLASSES.map((cls) => ({
        name: ASSET_CLASS_LABELS[cls],
        Objetivo: Number(derived[cls].toFixed(1)),
        Real: Number((actualByClass.get(cls) ?? 0).toFixed(1)),
        color: ASSET_CLASS_COLORS[cls],
      })),
    [derived, actualByClass]
  );

  const liveHierarchy = useMemo(
    () => computeHierarchyForGoal(goal, summary.classes),
    [goal, summary.classes]
  );

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

  function updatePair(
    leftKey: keyof GoalInput,
    rightKey: keyof GoalInput,
    nextLeftValue: number
  ) {
    const clamped = Math.max(0, Math.min(100, Math.round(nextLeftValue * 100) / 100));
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Objetivos
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Ajuste os percentuais hierárquicos da carteira. Cada nível soma
            automaticamente 100%.
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar objetivos"}
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Objetivos salvos com sucesso! O dashboard e o plano de aporte já
          refletem os novos percentuais.
        </div>
      )}

      {/* Sliders Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PAIRS.map((pair) => {
          const leftVal = goal[pair.leftKey];
          const rightVal = goal[pair.rightKey];
          return (
            <section
              key={pair.title}
              className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900"
            >
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {pair.title}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {pair.subtitle}
              </p>

              <div className="mt-4 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {pair.leftLabel}
                  </span>
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={leftVal}
                      onChange={(e) =>
                        updatePair(
                          pair.leftKey,
                          pair.rightKey,
                          Number(e.target.value)
                        )
                      }
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-mono text-base font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">
                      %
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {pair.rightLabel}
                  </span>
                  <div className="mt-1 flex items-center justify-end gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={rightVal}
                      onChange={(e) =>
                        updatePair(
                          pair.leftKey,
                          pair.rightKey,
                          100 - Number(e.target.value)
                        )
                      }
                      className="w-20 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-right font-mono text-base font-bold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <span className="text-sm font-semibold text-slate-400 dark:text-slate-500">
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
                value={leftVal}
                onChange={(e) =>
                  updatePair(
                    pair.leftKey,
                    pair.rightKey,
                    Number(e.target.value)
                  )
                }
                className="mt-4 h-2 w-full cursor-pointer accent-emerald-600"
              />
            </section>
          );
        })}
      </div>

      {/* Derived Final Percentages Preview */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Resultado Final por Classe
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Percentual efetivo de cada classe na carteira com os ajustes acima
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {INVESTMENT_CLASSES.map((cls) => {
            const target = derived[cls];
            const actual = actualByClass.get(cls) ?? 0;
            return (
              <div
                key={cls}
                className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/50"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: ASSET_CLASS_COLORS[cls] }}
                  />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {ASSET_CLASS_LABELS[cls]}
                  </span>
                </div>
                <p className="mt-2 font-mono text-xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {formatPct(target)}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                  Atual: {formatPct(actual)}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Real vs Objetivo Bar Chart */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Objetivo vs Real (%)
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Distribuição percentual por classe de ativos (atualiza em tempo real
          com os ajustes)
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

      {/* Hierarchy Breakdown */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Hierarquia dos Objetivos
        </h2>
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Macro (RF/RV), Geografia (Brasil/EUA) e Subclasses
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {liveHierarchy.map((row) => (
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

      {/* Sector Goals Section */}
      <SectorGoalsSection initialSummary={summary} />
    </div>
  );
}
