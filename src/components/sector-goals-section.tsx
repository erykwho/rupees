"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  ASSET_CLASS_COLORS,
  ASSET_CLASS_LABELS,
  VARIABLE_INCOME_CLASSES,
  type PortfolioSummary,
  type SectorSummary,
  type VariableIncomeClassKey,
  formatPct,
} from "@/lib/domain/types";
import { cn } from "@/lib/utils";

interface SectorGoalsSectionProps {
  initialSummary: PortfolioSummary;
}

export function SectorGoalsSection({
  initialSummary,
}: SectorGoalsSectionProps) {
  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [selectedClass, setSelectedClass] =
    useState<VariableIncomeClassKey>("BR_STOCK");

  // Add form state
  const [newName, setNewName] = useState("");
  const [newTargetPct, setNewTargetPct] = useState("");
  const [creating, setCreating] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTargetPct, setEditTargetPct] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function reloadSummary() {
    const res = await fetch("/api/portfolio");
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary);
    }
  }

  const classSectors = useMemo(() => {
    return summary.sectors
      .filter((s) => s.assetClass === selectedClass && s.id !== null)
      .sort((a, b) => {
        const aGoal = a.goalTargetPct ?? 0;
        const bGoal = b.goalTargetPct ?? 0;
        if (Math.abs(bGoal - aGoal) > 1e-6) return bGoal - aGoal;
        return a.sector.localeCompare(b.sector, "pt-BR");
      });
  }, [summary.sectors, selectedClass]);

  const classIssueMap = useMemo(() => {
    const map = new Map<VariableIncomeClassKey, boolean>();
    for (const cls of VARIABLE_INCOME_CLASSES) {
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
      map.set(cls, hasCoverageIssue || hasSumIssue);
    }
    return map;
  }, [summary.sectors]);

  const sectorSum = useMemo(() => {
    const sum = classSectors.reduce(
      (acc, s) => acc + (s.goalTargetPct ?? 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }, [classSectors]);

  const sumDiff = Math.round((sectorSum - 100) * 100) / 100;
  const isSumExact = classSectors.length > 0 && Math.abs(sumDiff) <= 0.05;
  const uncoveredCount = classSectors.filter(
    (s) => s.status === "UNCOVERED"
  ).length;

  function startEdit(sector: SectorSummary) {
    if (!sector.id) return;
    setError(null);
    setFeedback(null);
    setEditingId(sector.id);
    setEditName(sector.sector);
    setEditTargetPct(String(sector.goalTargetPct ?? 0));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditTargetPct("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Informe o nome do setor.");
      return;
    }

    setCreating(true);
    setError(null);
    setFeedback(null);

    try {
      const targetVal = Number(newTargetPct.replace(",", ".")) || 0;
      const res = await fetch("/api/sector-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass: selectedClass,
          name: trimmed,
          targetPct: targetVal,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao criar objetivo de setor.");
        return;
      }

      setNewName("");
      setNewTargetPct("");
      setFeedback(`Setor "${trimmed}" adicionado.`);
      await reloadSummary();
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveEdit(id: string) {
    const trimmed = editName.trim();
    if (!trimmed) {
      setError("O nome do setor não pode ficar vazio.");
      return;
    }

    setSavingId(id);
    setError(null);
    setFeedback(null);

    try {
      const targetVal = Number(editTargetPct.replace(",", "."));
      if (!Number.isFinite(targetVal) || targetVal < 0 || targetVal > 100) {
        setError("Informe um percentual entre 0% e 100%.");
        return;
      }

      const res = await fetch(`/api/sector-goals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          targetPct: targetVal,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao atualizar setor.");
        return;
      }

      setEditingId(null);
      setFeedback(`Setor "${trimmed}" atualizado.`);
      await reloadSummary();
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(sector: SectorSummary) {
    if (!sector.id) return;
    setError(null);
    setFeedback(null);

    if (sector.totalAssetCount > 0) {
      const tickersText =
        sector.assetTickers.length > 0
          ? `: ${sector.assetTickers.join(", ")}`
          : "";
      setError(
        `Não é possível excluir "${sector.sector}" (${sector.totalAssetCount} ${sector.totalAssetCount === 1 ? "ativo" : "ativos"}${tickersText}). Reatribua na Carteira antes.`
      );
      return;
    }

    if (!window.confirm(`Excluir o objetivo do setor "${sector.sector}"?`)) {
      return;
    }

    setDeletingId(sector.id);
    try {
      const res = await fetch(`/api/sector-goals/${sector.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao excluir setor.");
        return;
      }

      setFeedback(`Setor "${sector.sector}" removido.`);
      await reloadSummary();
    } finally {
      setDeletingId(null);
    }
  }

  function renderStatusBadge(s: SectorSummary) {
    if (s.status === "UNCOVERED") {
      return (
        <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
          Sem ativos
        </span>
      );
    }
    if (s.status === "UNDER") {
      const missing = Math.abs(s.diffFromGoalPct ?? 0);
      return (
        <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
          -{formatPct(missing, 1)}
        </span>
      );
    }
    if (s.status === "OVER") {
      const excess = Math.abs(s.diffFromGoalPct ?? 0);
      return (
        <span className="rounded-full bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
          +{formatPct(excess, 1)}
        </span>
      );
    }
    return null;
  }

  return (
    <section className="space-y-4">
      {/* Single-Row Class Selector */}
      <div className="grid w-full grid-cols-4 gap-1 rounded-xl border border-slate-200/80 bg-white p-1 shadow-2xs sm:inline-flex sm:w-auto dark:border-slate-800 dark:bg-slate-900">
        {VARIABLE_INCOME_CLASSES.map((cls) => {
          const active = selectedClass === cls;
          const hasIssue = classIssueMap.get(cls);
          return (
            <button
              key={cls}
              type="button"
              onClick={() => {
                setSelectedClass(cls);
                cancelEdit();
                setError(null);
                setFeedback(null);
              }}
              className={cn(
                "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:px-3",
                active
                  ? "bg-emerald-600 text-white"
                  : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: active
                    ? "#ffffff"
                    : ASSET_CLASS_COLORS[cls],
                }}
              />
              <span>{ASSET_CLASS_LABELS[cls]}</span>
              {hasIssue && (
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    active ? "bg-amber-200" : "bg-amber-500"
                  )}
                  title="Pendências nesta classe"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Main Sector List Card */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        {/* Compact Sum Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-500 dark:text-slate-400">
              Soma:
            </span>
            <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
              {formatPct(sectorSum, 1)}
            </span>
            {classSectors.length > 0 &&
              (isSumExact ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {sumDiff < 0
                    ? `Faltam ${formatPct(Math.abs(sumDiff), 1)}`
                    : `+${formatPct(sumDiff, 1)}`}
                </span>
              ))}
          </div>

          {uncoveredCount > 0 && (
            <Link
              href="/carteira"
              className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
            >
              {uncoveredCount} sem ativos →
            </Link>
          )}
        </div>

        {error && (
          <div className="mx-4 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
            {error}
          </div>
        )}

        {feedback && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            {feedback}
          </div>
        )}

        {/* Mobile-Friendly Sector List with Real vs Target Bars */}
        {classSectors.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {classSectors.map((sector) => {
              const isEditing = editingId === sector.id;
              const goalPct = sector.goalTargetPct ?? 0;
              const actualPct = sector.actualPctInClass;
              const statusBadge = renderStatusBadge(sector);

              return (
                <div
                  key={sector.id ?? sector.sector}
                  className="px-4 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                >
                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        aria-label="Nome do setor"
                        className="min-w-0 flex-1 rounded-lg border border-emerald-400 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                      />
                      <div className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          aria-label="Meta do setor"
                          value={editTargetPct}
                          onChange={(e) => setEditTargetPct(e.target.value)}
                          className="w-16 rounded-lg border border-emerald-400 bg-white px-2 py-1.5 text-right font-mono text-xs font-bold text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                        />
                        <span className="text-xs text-slate-400">%</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => sector.id && handleSaveEdit(sector.id)}
                        disabled={savingId === sector.id}
                        className="rounded-lg bg-emerald-600 p-1.5 text-white hover:bg-emerald-700 disabled:opacity-60"
                        title="Salvar"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        title="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {sector.sector}
                          </span>
                          {statusBadge}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <span className="font-mono text-xs tabular-nums">
                            <strong className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatPct(actualPct, 1)}
                            </strong>
                            <span className="ml-1 text-[11px] text-slate-400 dark:text-slate-500">
                              / {formatPct(goalPct, 1)}
                            </span>
                          </span>
                          <div className="inline-flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => startEdit(sector)}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                              title="Editar setor"
                              aria-label={`Editar ${sector.sector}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(sector)}
                              disabled={deletingId === sector.id}
                              className={cn(
                                "rounded-lg p-1 transition-colors disabled:opacity-60",
                                sector.totalAssetCount > 0
                                  ? "text-slate-300 hover:bg-slate-100 hover:text-amber-600 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-amber-400"
                                  : "text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                              )}
                              title={
                                sector.totalAssetCount > 0
                                  ? "Possui ativos vinculados"
                                  : "Excluir setor"
                              }
                              aria-label={`Excluir ${sector.sector}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Real vs Target Bar */}
                      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(0, actualPct))}%`,
                            backgroundColor: ASSET_CLASS_COLORS[selectedClass],
                          }}
                        />
                        {goalPct > 0 && goalPct <= 100 && (
                          <span
                            title={`Meta: ${formatPct(goalPct, 1)}`}
                            className="absolute inset-y-0 w-0.5 bg-slate-900/75 dark:bg-white/80"
                            style={{ left: `${Math.min(99.5, goalPct)}%` }}
                          />
                        )}
                      </div>

                      {/* Tickers & asset target info */}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="truncate font-mono">
                          {sector.activeAssetCount > 0
                            ? sector.assetTickers.join(", ")
                            : "Nenhum ativo"}
                        </span>
                        {Math.abs(sector.targetPctInClass - goalPct) > 0.05 && (
                          <span className="shrink-0 font-mono tabular-nums">
                            Ativos: {formatPct(sector.targetPctInClass, 1)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
            Nenhum setor cadastrado em{" "}
            <strong>{ASSET_CLASS_LABELS[selectedClass]}</strong>.
          </div>
        )}

        {/* Add New Sector Form */}
        <form
          onSubmit={handleCreate}
          className="flex items-center gap-2 border-t border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`Novo setor em ${ASSET_CLASS_LABELS[selectedClass]}...`}
            className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <div className="flex shrink-0 items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={newTargetPct}
              onChange={(e) => setNewTargetPct(e.target.value)}
              placeholder="%"
              className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              disabled={creating}
              aria-label="Adicionar setor"
              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Adicionar</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
