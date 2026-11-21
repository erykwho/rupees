"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Layers,
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
        (s) => s.status === "UNCOVERED" || s.status === "UNDER" || s.status === "OVER"
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
      setFeedback(`Setor "${trimmed}" adicionado em ${ASSET_CLASS_LABELS[selectedClass]}.`);
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
        `Não é possível excluir "${sector.sector}" pois há ${sector.totalAssetCount} ativo${sector.totalAssetCount === 1 ? "" : "s"} vinculado${sector.totalAssetCount === 1 ? "" : "s"}${tickersText}. Reatribua na Carteira antes de excluir.`
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
        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900">
          Sem ativos
        </span>
      );
    }
    if (s.status === "UNDER") {
      const missing = Math.abs(s.diffFromGoalPct ?? 0);
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900">
          Faltam {formatPct(missing, 1)}
        </span>
      );
    }
    if (s.status === "OVER") {
      const excess = Math.abs(s.diffFromGoalPct ?? 0);
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-700 ring-1 ring-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900">
          +{formatPct(excess, 1)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900">
        OK
      </span>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Objetivos por Setor
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Defina a meta de cada setor dentro das classes de Renda Variável e
            acompanhe se todos possuem ativos alocados.
          </p>
        </div>

        {/* Class tabs */}
        <div className="flex flex-wrap gap-1.5">
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
                  "relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: active
                      ? "#ffffff"
                      : ASSET_CLASS_COLORS[cls],
                  }}
                />
                {ASSET_CLASS_LABELS[cls]}
                {hasIssue && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      active ? "bg-amber-200" : "bg-amber-500"
                    )}
                    title="Há ajustes pendentes nesta classe"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Class sum status bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-600 dark:text-slate-300">
            Soma dos setores ({ASSET_CLASS_LABELS[selectedClass]}):
          </span>
          <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
            {formatPct(sectorSum, 2)}
          </span>
          {classSectors.length === 0 ? (
            <span className="text-slate-400 dark:text-slate-500">
              · Nenhum setor cadastrado
            </span>
          ) : isSumExact ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Fecha em 100%
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {sumDiff < 0
                ? `Faltam ${formatPct(Math.abs(sumDiff), 2)}`
                : `Excede ${formatPct(sumDiff, 2)}`}
            </span>
          )}
        </div>

        {uncoveredCount > 0 && (
          <Link
            href="/carteira"
            className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
          >
            {uncoveredCount} setor{uncoveredCount === 1 ? "" : "es"} sem ativos →
          </Link>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      )}

      {feedback && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          {feedback}
        </div>
      )}

      {/* Sectors Table / List */}
      {classSectors.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-2 pr-3">Setor</th>
                <th className="px-2 py-2 text-right">% Alvo</th>
                <th className="px-2 py-2 text-right">% em Ativos</th>
                <th className="px-2 py-2 text-center">Status</th>
                <th className="py-2 pl-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {classSectors.map((sector) => {
                const isEditing = editingId === sector.id;
                return (
                  <tr
                    key={sector.id ?? sector.sector}
                    className="group hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
                  >
                    <td className="py-2.5 pr-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full min-w-36 rounded-lg border border-emerald-400 bg-white px-2.5 py-1 text-xs font-medium text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                        />
                      ) : (
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {sector.sector}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                            {sector.activeAssetCount > 0 ? (
                              <>
                                {sector.activeAssetCount} ativo
                                {sector.activeAssetCount === 1 ? "" : "s"}:{" "}
                                <span className="font-mono text-slate-500 dark:text-slate-400">
                                  {sector.assetTickers.join(", ")}
                                </span>
                              </>
                            ) : (
                              "Nenhum ativo alocado"
                            )}
                          </p>
                        </div>
                      )}
                    </td>

                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            value={editTargetPct}
                            onChange={(e) => setEditTargetPct(e.target.value)}
                            className="w-20 rounded-lg border border-emerald-400 bg-white px-2 py-1 text-right font-mono text-xs font-bold text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-slate-100"
                          />
                          <span className="text-slate-400">%</span>
                        </div>
                      ) : (
                        <span className="font-bold text-slate-900 dark:text-slate-100">
                          {formatPct(sector.goalTargetPct ?? 0, 1)}
                        </span>
                      )}
                    </td>

                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatPct(sector.targetPctInClass, 1)}
                    </td>

                    <td className="px-2 py-2.5 text-center">
                      {renderStatusBadge(sector)}
                    </td>

                    <td className="py-2.5 pl-2 text-right">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-1">
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
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => startEdit(sector)}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Editar setor"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(sector)}
                            disabled={deletingId === sector.id}
                            className={cn(
                              "rounded-lg p-1.5 transition-colors disabled:opacity-60",
                              sector.totalAssetCount > 0
                                ? "text-slate-300 hover:bg-slate-100 hover:text-amber-600 dark:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-amber-400"
                                : "text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                            )}
                            title={
                              sector.totalAssetCount > 0
                                ? "Possui ativos vinculados"
                                : "Excluir setor"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhum objetivo de setor cadastrado para{" "}
          <strong>{ASSET_CLASS_LABELS[selectedClass]}</strong> ainda. Adicione o
          primeiro abaixo.
        </div>
      )}

      {/* Add new sector form */}
      <form
        onSubmit={handleCreate}
        className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center dark:border-slate-800"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={`Novo setor em ${ASSET_CLASS_LABELS[selectedClass]} (ex: Transporte, Logística...)`}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={newTargetPct}
              onChange={(e) => setNewTargetPct(e.target.value)}
              placeholder="Meta %"
              className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-right font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <span className="text-xs font-semibold text-slate-400">%</span>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? "Adicionando..." : "Adicionar"}
          </button>
        </div>
      </form>
    </section>
  );
}
