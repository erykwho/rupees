"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  Calculator,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Pencil,
  PiggyBank,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Target,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  type EmergencyReserveScenario,
  SAVINGS_MOVEMENT_TYPE_LABELS,
  type SavingsGoalSummary,
  type SavingsMovementDTO,
  type SavingsMovementTypeKey,
  type SavingsSummary,
  type SavingsVehicleSummary,
  evaluateEmergencyReserveCalculator,
} from "@/lib/domain/savings";
import { formatPct } from "@/lib/domain/types";
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
import { usePrivacy } from "@/components/privacy-provider";
import { maskBRL, maskSignedBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface SavingsViewProps {
  initialSummary: SavingsSummary;
}

type SavingsTab = "GOALS" | "MOVEMENTS" | "CUSTODY";
type MovementModalMode = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER" | "YIELD_ADJUSTMENT";

function parseBrDecimal(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

function formatDatePtBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function formatMonthYearPtBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m] = iso.slice(0, 10).split("-");
  if (!y || !m) return iso;
  return `${m}/${y}`;
}

function getTodayDateInput(): string {
  return new Date().toLocaleDateString("en-CA");
}

function getMovementBadgeClass(type: SavingsMovementTypeKey): string {
  switch (type) {
    case "DEPOSIT":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "WITHDRAWAL":
      return "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
    case "TRANSFER_OUT":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
    case "TRANSFER_IN":
      return "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300";
    case "YIELD_ADJUSTMENT":
      return "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300";
  }
}

export function SavingsView({ initialSummary }: SavingsViewProps) {
  const router = useRouter();
  const { isPrivate } = usePrivacy();

  const [summary, setSummary] = useState<SavingsSummary>(initialSummary);
  const [activeTab, setActiveTab] = useState<SavingsTab>("GOALS");
  const [showClosedGoals, setShowClosedGoals] = useState(false);

  // Movement filters
  const [filterGoalId, setFilterGoalId] = useState<string>("ALL");
  const [filterVehicleId, setFilterVehicleId] = useState<string>("ALL");

  // Feedback banner
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Goal modal state
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoalSummary | null>(null);
  const [goalName, setGoalName] = useState("");
  const [goalTargetAmount, setGoalTargetAmount] = useState("");
  const [goalTargetDate, setGoalTargetDate] = useState("");
  const [goalIsReserve, setGoalIsReserve] = useState(false);
  const [goalIsClosed, setGoalIsClosed] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  // Movement modal state
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [movementMode, setMovementMode] = useState<MovementModalMode>("DEPOSIT");
  const [movGoalId, setMovGoalId] = useState("");
  const [movVehicleId, setMovVehicleId] = useState("");
  const [movDestGoalId, setMovDestGoalId] = useState("");
  const [movDestVehicleId, setMovDestVehicleId] = useState("");
  const [movDate, setMovDate] = useState(getTodayDateInput());
  const [movAmount, setMovAmount] = useState("");
  const [movNotes, setMovNotes] = useState("");
  const [savingMovement, setSavingMovement] = useState(false);

  // Inline quick vehicle creation inside movement modal
  const [quickVehicleOpen, setQuickVehicleOpen] = useState(false);
  const [quickVehicleName, setQuickVehicleName] = useState("");
  const [savingQuickVehicle, setSavingQuickVehicle] = useState(false);

  // Vehicle modal state
  const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] =
    useState<SavingsVehicleSummary | null>(null);
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleInstitution, setVehicleInstitution] = useState("");
  const [vehicleArchived, setVehicleArchived] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);

  // Emergency Reserve Calculator modal state
  const [calcModalOpen, setCalcModalOpen] = useState(false);
  const [calcMonthlyExpense, setCalcMonthlyExpense] = useState(
    String(initialSummary.reserveCalculator.monthlyExpenseBRL || "")
  );
  const [calcScenarios, setCalcScenarios] = useState<EmergencyReserveScenario[]>(
    initialSummary.reserveCalculator.scenarios
  );
  const [savingCalc, setSavingCalc] = useState(false);

  // Delete confirmation state
  const [deletingMovementId, setDeletingMovementId] = useState<string | null>(
    null
  );

  const activeVehicles = useMemo(
    () => summary.vehicles.filter((v) => !v.isArchived),
    [summary.vehicles]
  );

  const filteredMovements = useMemo(() => {
    return summary.movements.filter((m) => {
      if (filterGoalId !== "ALL" && m.goalId !== filterGoalId) return false;
      if (filterVehicleId !== "ALL" && m.vehicleId !== filterVehicleId)
        return false;
      return true;
    });
  }, [summary.movements, filterGoalId, filterVehicleId]);

  const liveCalcPreview = useMemo(() => {
    const expense = parseBrDecimal(calcMonthlyExpense);
    return evaluateEmergencyReserveCalculator({
      monthlyExpenseBRL: Number.isFinite(expense) ? expense : 0,
      scenarios: calcScenarios,
    });
  }, [calcMonthlyExpense, calcScenarios]);

  const nonZeroVehiclesForMatrix = useMemo(() => {
    return summary.vehicles.filter(
      (v) => Math.abs(v.totalBRL) >= 0.005 || v.goalBreakdown.length > 0
    );
  }, [summary.vehicles]);

  const nonZeroMatrixRows = useMemo(() => {
    return summary.matrixRows.filter(
      (row) => !row.isClosed || Math.abs(row.totalBRL) >= 0.005
    );
  }, [summary.matrixRows]);

  async function refreshSummary() {
    const res = await fetch("/api/savings", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary as SavingsSummary);
    }
    router.refresh();
  }

  function openCreateGoalModal() {
    setEditingGoal(null);
    setGoalName("");
    setGoalTargetAmount("");
    setGoalTargetDate("");
    setGoalIsReserve(summary.emergencyReserveGoal === null);
    setGoalIsClosed(false);
    setGoalModalOpen(true);
  }

  function openEditGoalModal(goal: SavingsGoalSummary) {
    setEditingGoal(goal);
    setGoalName(goal.name);
    setGoalTargetAmount(
      goal.targetAmount !== null ? String(goal.targetAmount) : ""
    );
    setGoalTargetDate(goal.targetDate ? goal.targetDate.slice(0, 10) : "");
    setGoalIsReserve(goal.isEmergencyReserve);
    setGoalIsClosed(goal.isClosed);
    setGoalModalOpen(true);
  }

  async function handleSaveGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!goalName.trim()) return;
    setSavingGoal(true);
    setFeedback(null);

    try {
      const parsedTarget =
        goalTargetAmount.trim() === ""
          ? null
          : parseBrDecimal(goalTargetAmount);
      if (parsedTarget !== null && (!Number.isFinite(parsedTarget) || parsedTarget < 0)) {
        setFeedback({ type: "error", message: "Valor-alvo inválido." });
        return;
      }

      const payload = {
        name: goalName.trim(),
        targetAmount: parsedTarget,
        targetDate: goalTargetDate.trim() || null,
        isEmergencyReserve: goalIsReserve,
        ...(editingGoal ? { isClosed: goalIsClosed } : {}),
      };

      const url = editingGoal
        ? `/api/savings/goals/${editingGoal.id}`
        : "/api/savings/goals";
      const method = editingGoal ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao salvar caixinha.",
        });
        return;
      }

      setGoalModalOpen(false);
      setFeedback({
        type: "success",
        message: editingGoal
          ? `Caixinha "${goalName.trim()}" atualizada.`
          : `Caixinha "${goalName.trim()}" criada.`,
      });
      await refreshSummary();
    } finally {
      setSavingGoal(false);
    }
  }

  async function handleToggleCloseGoal(goal: SavingsGoalSummary) {
    setFeedback(null);
    const res = await fetch(`/api/savings/goals/${goal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isClosed: !goal.isClosed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFeedback({
        type: "error",
        message: data.error ?? "Erro ao atualizar status da caixinha.",
      });
      return;
    }
    setFeedback({
      type: "success",
      message: goal.isClosed
        ? `Caixinha "${goal.name}" reaberta.`
        : `Caixinha "${goal.name}" encerrada.`,
    });
    await refreshSummary();
  }

  async function handleDeleteGoal(goal: SavingsGoalSummary) {
    if (!window.confirm(`Excluir a caixinha "${goal.name}"?`)) return;
    setFeedback(null);
    const res = await fetch(`/api/savings/goals/${goal.id}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFeedback({
        type: "error",
        message: data.error ?? "Não foi possível excluir a caixinha.",
      });
      return;
    }
    setGoalModalOpen(false);
    setFeedback({
      type: "success",
      message: `Caixinha "${goal.name}" excluída.`,
    });
    await refreshSummary();
  }

  function openMovementModal(options?: {
    mode?: MovementModalMode;
    goal?: SavingsGoalSummary;
  }) {
    const defaultGoal = options?.goal ?? summary.activeGoals[0] ?? summary.goals[0];
    const secondGoal =
      summary.activeGoals.find((g) => g.id !== defaultGoal?.id) ?? defaultGoal;
    const defaultVehicleId =
      defaultGoal?.lastVehicleId ?? activeVehicles[0]?.id ?? summary.vehicles[0]?.id ?? "";

    setMovementMode(options?.mode ?? "DEPOSIT");
    setMovGoalId(defaultGoal?.id ?? "");
    setMovVehicleId(defaultVehicleId);
    setMovDestGoalId(secondGoal?.id ?? "");
    setMovDestVehicleId(defaultVehicleId);
    setMovDate(getTodayDateInput());
    setMovAmount("");
    setMovNotes("");
    setQuickVehicleOpen(false);
    setQuickVehicleName("");
    setMovementModalOpen(true);
  }

  async function handleQuickCreateVehicle() {
    if (!quickVehicleName.trim()) return;
    setSavingQuickVehicle(true);
    try {
      const res = await fetch("/api/savings/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: quickVehicleName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao criar produto.",
        });
        return;
      }
      const createdId = data.vehicle?.id as string | undefined;
      await refreshSummary();
      if (createdId) {
        setMovVehicleId(createdId);
        if (!movDestVehicleId) setMovDestVehicleId(createdId);
      }
      setQuickVehicleName("");
      setQuickVehicleOpen(false);
    } finally {
      setSavingQuickVehicle(false);
    }
  }

  async function handleSaveMovement(event: React.FormEvent) {
    event.preventDefault();
    const numericAmount = parseBrDecimal(movAmount);
    if (!Number.isFinite(numericAmount) || Math.abs(numericAmount) < 0.01) {
      setFeedback({ type: "error", message: "Informe um valor válido." });
      return;
    }

    setSavingMovement(true);
    setFeedback(null);

    try {
      const payload =
        movementMode === "TRANSFER"
          ? {
              mode: "TRANSFER",
              sourceGoalId: movGoalId,
              sourceVehicleId: movVehicleId,
              destGoalId: movDestGoalId,
              destVehicleId: movDestVehicleId,
              date: movDate,
              amount: Math.abs(numericAmount),
              notes: movNotes.trim() || null,
            }
          : movementMode === "YIELD_ADJUSTMENT"
            ? {
                mode: "YIELD_ADJUSTMENT",
                goalId: movGoalId,
                vehicleId: movVehicleId,
                date: movDate,
                signedAmount: numericAmount,
                notes: movNotes.trim() || null,
              }
            : {
                mode: movementMode,
                goalId: movGoalId,
                vehicleId: movVehicleId,
                date: movDate,
                amount: Math.abs(numericAmount),
                notes: movNotes.trim() || null,
              };

      const res = await fetch("/api/savings/movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao registrar movimentação.",
        });
        return;
      }

      setMovementModalOpen(false);
      setFeedback({
        type: "success",
        message:
          movementMode === "TRANSFER"
            ? "Transferência registrada."
            : "Movimentação registrada.",
      });
      await refreshSummary();
    } finally {
      setSavingMovement(false);
    }
  }

  async function handleDeleteMovement(movement: SavingsMovementDTO) {
    const confirmMsg = movement.transferGroupId
      ? "Esta movimentação faz parte de uma transferência. Excluir os dois lados da transferência?"
      : `Excluir ${SAVINGS_MOVEMENT_TYPE_LABELS[movement.type].toLowerCase()} de ${movement.goalName}?`;
    if (!window.confirm(confirmMsg)) return;

    setDeletingMovementId(movement.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/savings/movements/${movement.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao excluir movimentação.",
        });
        return;
      }
      setFeedback({ type: "success", message: "Movimentação excluída." });
      await refreshSummary();
    } finally {
      setDeletingMovementId(null);
    }
  }

  function openVehicleModal(vehicle?: SavingsVehicleSummary) {
    setEditingVehicle(vehicle ?? null);
    setVehicleName(vehicle?.name ?? "");
    setVehicleInstitution(vehicle?.institution ?? "");
    setVehicleArchived(vehicle?.isArchived ?? false);
    setVehicleModalOpen(true);
  }

  async function handleSaveVehicle(event: React.FormEvent) {
    event.preventDefault();
    if (!vehicleName.trim()) return;
    setSavingVehicle(true);
    setFeedback(null);
    try {
      const url = editingVehicle
        ? `/api/savings/vehicles/${editingVehicle.id}`
        : "/api/savings/vehicles";
      const method = editingVehicle ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: vehicleName.trim(),
          institution: vehicleInstitution.trim() || null,
          ...(editingVehicle ? { isArchived: vehicleArchived } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao salvar produto.",
        });
        return;
      }
      setVehicleModalOpen(false);
      setFeedback({
        type: "success",
        message: editingVehicle ? "Produto atualizado." : "Produto criado.",
      });
      await refreshSummary();
    } finally {
      setSavingVehicle(false);
    }
  }

  function openReserveCalculator() {
    setCalcMonthlyExpense(
      summary.reserveCalculator.monthlyExpenseBRL > 0
        ? String(summary.reserveCalculator.monthlyExpenseBRL)
        : ""
    );
    setCalcScenarios(summary.reserveCalculator.scenarios.map((s) => ({ ...s })));
    setCalcModalOpen(true);
  }

  function addCalculatorScenario() {
    setCalcScenarios((prev) => [
      ...prev,
      {
        id: `scenario-${Date.now()}`,
        label: "Novo evento",
        mode: "FIXED",
        months: null,
        fixedAmount: 0,
      },
    ]);
  }

  async function handleSaveReserveCalculator(applyToReserveGoal: boolean) {
    setSavingCalc(true);
    setFeedback(null);
    try {
      const monthlyExpense = parseBrDecimal(calcMonthlyExpense);
      const res = await fetch("/api/savings/reserve-calculator", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthlyExpenseBRL:
            Number.isFinite(monthlyExpense) && monthlyExpense >= 0
              ? monthlyExpense
              : 0,
          scenarios: calcScenarios.map((s) => ({
            id: s.id,
            label: s.label.trim() || "Cenário",
            mode: s.mode,
            months: s.mode === "MONTHS" ? (s.months ?? 0) : null,
            fixedAmount: s.mode === "FIXED" ? (s.fixedAmount ?? 0) : null,
          })),
          applyToReserveGoal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error ?? "Erro ao salvar calculadora da reserva.",
        });
        return;
      }
      setCalcModalOpen(false);
      setFeedback({
        type: "success",
        message: applyToReserveGoal
          ? "Cálculo salvo e meta da Reserva de Emergência atualizada."
          : "Cálculo da reserva salvo.",
      });
      await refreshSummary();
    } finally {
      setSavingCalc(false);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            Caixinhas
          </h1>
          <span className="hidden rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 sm:inline dark:bg-teal-950/60 dark:text-teal-300">
            Amanhã
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={openReserveCalculator}
            title="Calculadora da Reserva de Emergência"
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Calculator className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span className="hidden sm:inline">Reserva</span>
          </button>

          <button
            type="button"
            onClick={openCreateGoalModal}
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Caixinha</span>
          </button>

          <button
            type="button"
            onClick={() => openMovementModal()}
            disabled={summary.goals.length === 0}
            className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            <span>Movimentar</span>
          </button>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-300"
          )}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Fechar aviso"
            className="rounded-lg p-1 opacity-70 hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <CompactKpiStrip
        columns={3}
        items={[
          {
            id: "total-saved",
            label: "Total nas caixinhas",
            value: maskBRL(summary.totalActiveBalanceBRL, isPrivate),
            icon: (
              <PiggyBank className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            ),
            subtext: `${summary.activeGoals.length} ativa${summary.activeGoals.length === 1 ? "" : "s"}`,
          },
          {
            id: "total-missing",
            label: "Falta p/ metas",
            value: maskBRL(summary.totalMissingBRL, isPrivate),
            icon: (
              <Target className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            ),
          },
          {
            id: "required-monthly",
            label: "Necessário / mês",
            value: maskBRL(summary.totalRequiredMonthlyBRL, isPrivate),
            icon: (
              <Calendar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            ),
            highlighted: true,
            mobileFullRow: true,
          },
        ]}
      />

      {/* Single-Row 3-Tab Switcher */}
      <div className="grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:inline-flex sm:w-auto dark:border-slate-800 dark:bg-slate-900">
        {(
          [
            { id: "GOALS", label: "Caixinhas" },
            { id: "MOVEMENTS", label: "Movimentações" },
            { id: "CUSTODY", label: "Onde está" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition sm:px-4",
              activeTab === tab.id
                ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: CAIXINHAS */}
      {activeTab === "GOALS" && (
        <div className="space-y-4">
          {summary.activeGoals.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <PiggyBank className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
              <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                Nenhuma caixinha ativa ainda
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Crie sua Reserva de Emergência ou objetivos de curto e médio prazo.
              </p>
              <button
                type="button"
                onClick={openCreateGoalModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Criar primeira caixinha
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {summary.activeGoals.map((goal) => (
                <article
                  key={goal.id}
                  className={cn(
                    "flex flex-col justify-between rounded-2xl border bg-white p-4 shadow-2xs transition-colors dark:bg-slate-900",
                    goal.isEmergencyReserve
                      ? "border-teal-200/90 dark:border-teal-900/70"
                      : "border-slate-200/80 dark:border-slate-800"
                  )}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {goal.isEmergencyReserve && (
                            <Shield className="h-3.5 w-3.5 shrink-0 text-teal-600 dark:text-teal-400" />
                          )}
                          <h2 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                            {goal.name}
                          </h2>
                        </div>
                        {goal.lastVehicleName && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                            Último: {goal.lastVehicleName}
                          </p>
                        )}
                      </div>

                      <p className="shrink-0 font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {maskBRL(goal.currentBalanceBRL, isPrivate)}
                      </p>
                    </div>

                    {goal.targetAmount !== null ? (
                      <div className="mt-3 space-y-1.5">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              goal.isEmergencyReserve
                                ? "bg-teal-500"
                                : "bg-emerald-500"
                            )}
                            style={{ width: `${goal.progressPct ?? 0}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                          <span>
                            {formatPct(goal.progressPct ?? 0, 0)} de{" "}
                            <strong className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {maskBRL(goal.targetAmount, isPrivate)}
                            </strong>
                          </span>
                          {goal.missingAmountBRL !== null &&
                            goal.missingAmountBRL > 0 && (
                              <span>
                                Falta{" "}
                                <strong className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                  {maskBRL(goal.missingAmountBRL, isPrivate)}
                                </strong>
                              </span>
                            )}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500">
                        Fundo livre (sem meta fixa)
                      </p>
                    )}

                    {(goal.targetDate || goal.requiredMonthlyBRL !== null) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                        {goal.targetDate && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            <Calendar className="h-3 w-3" />
                            {formatMonthYearPtBR(goal.targetDate)}
                            {goal.remainingMonths !== null &&
                              ` · ${goal.remainingMonths} ${goal.remainingMonths === 1 ? "mês" : "meses"}`}
                          </span>
                        )}
                        {goal.requiredMonthlyBRL !== null &&
                          goal.requiredMonthlyBRL > 0 && (
                            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 font-mono font-semibold text-emerald-700 tabular-nums dark:bg-emerald-950/60 dark:text-emerald-300">
                              {maskBRL(goal.requiredMonthlyBRL, isPrivate)}/mês
                            </span>
                          )}
                      </div>
                    )}
                  </div>

                  {/* Quick Action Row */}
                  <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          openMovementModal({ mode: "DEPOSIT", goal })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-950"
                      >
                        <ArrowDownLeft className="h-3 w-3" />
                        Aportar
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          openMovementModal({ mode: "WITHDRAWAL", goal })
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                      >
                        <ArrowUpRight className="h-3 w-3" />
                        Resgatar
                      </button>
                    </div>

                    <div className="flex items-center gap-1">
                      {goal.isEmergencyReserve && (
                        <button
                          type="button"
                          onClick={openReserveCalculator}
                          title="Calcular meta da reserva"
                          className="rounded-lg p-1.5 text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-950/60"
                        >
                          <Calculator className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEditGoalModal(goal)}
                        title="Editar caixinha"
                        aria-label={`Editar ${goal.name}`}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {/* Closed / Archived Goals Collapsible */}
          {summary.closedGoals.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setShowClosedGoals((prev) => !prev)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
              >
                <span className="flex items-center gap-2">
                  <Archive className="h-3.5 w-3.5 text-slate-400" />
                  Caixinhas encerradas ({summary.closedGoals.length})
                </span>
                {showClosedGoals ? (
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                )}
              </button>

              {showClosedGoals && (
                <div className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                  {summary.closedGoals.map((goal) => (
                    <div
                      key={goal.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-700 dark:text-slate-300">
                          {goal.name}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {goal.movementCount} movimentaç
                          {goal.movementCount === 1 ? "ão" : "ões"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono font-semibold text-slate-600 tabular-nums dark:text-slate-300">
                          {maskBRL(goal.currentBalanceBRL, isPrivate)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleToggleCloseGoal(goal)}
                          title="Reabrir caixinha"
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Reabrir
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* TAB 2: MOVIMENTAÇÕES */}
      {activeTab === "MOVEMENTS" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <select
              aria-label="Filtrar por caixinha"
              value={filterGoalId}
              onChange={(e) => setFilterGoalId(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="ALL">Todas caixinhas</option>
              {summary.goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              aria-label="Filtrar por produto"
              value={filterVehicleId}
              onChange={(e) => setFilterVehicleId(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <option value="ALL">Todos produtos</option>
              {summary.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>

          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            {filteredMovements.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-400 dark:text-slate-500">
                Nenhuma movimentação encontrada para o filtro selecionado.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredMovements.map((mov) => (
                  <div
                    key={mov.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                          {mov.goalName}
                        </span>
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                            getMovementBadgeClass(mov.type)
                          )}
                        >
                          {SAVINGS_MOVEMENT_TYPE_LABELS[mov.type]}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {formatDatePtBR(mov.date)} · {mov.vehicleName}
                        {mov.notes ? ` · ${mov.notes}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "font-mono text-xs font-bold tabular-nums sm:text-sm",
                          mov.signedAmount >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {maskSignedBRL(mov.signedAmount, isPrivate)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteMovement(mov)}
                        disabled={deletingMovementId === mov.id}
                        title="Excluir movimentação"
                        aria-label="Excluir movimentação"
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 3: ONDE ESTÁ (CUSTÓDIA / MATRIZ) */}
      {activeTab === "CUSTODY" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Concilie o total por título/CDB com o saldo da corretora.
            </p>
            <button
              type="button"
              onClick={() => openVehicleModal()}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              Produto
            </button>
          </div>

          {summary.vehicles.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Nenhum produto de custódia cadastrado (ex.: Tesouro Selic 2031, CDB Inter).
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {summary.vehicles.map((vehicle) => (
                <article
                  key={vehicle.id}
                  className={cn(
                    "rounded-2xl border bg-white p-4 shadow-2xs dark:bg-slate-900",
                    vehicle.isArchived
                      ? "border-slate-200/60 opacity-70 dark:border-slate-800/70"
                      : "border-slate-200/80 dark:border-slate-800"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <h3 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">
                          {vehicle.name}
                        </h3>
                        {vehicle.isArchived && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            Arquivado
                          </span>
                        )}
                      </div>
                      {vehicle.institution && (
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {vehicle.institution}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={cn(
                          "font-mono text-sm font-bold tabular-nums",
                          vehicle.totalBRL < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-slate-900 dark:text-slate-100"
                        )}
                      >
                        {maskBRL(vehicle.totalBRL, isPrivate)}
                      </span>
                      <button
                        type="button"
                        onClick={() => openVehicleModal(vehicle)}
                        title="Editar produto"
                        aria-label={`Editar ${vehicle.name}`}
                        className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {vehicle.goalBreakdown.length > 0 ? (
                    <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
                      {vehicle.goalBreakdown.map((item) => (
                        <div
                          key={item.goalId}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate text-slate-600 dark:text-slate-300">
                            {item.goalName}
                            {item.isClosed ? " (encerrada)" : ""}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-mono font-semibold tabular-nums",
                              item.balanceBRL < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-slate-800 dark:text-slate-200"
                            )}
                          >
                            {maskBRL(item.balanceBRL, isPrivate)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2.5 text-[11px] text-slate-400 dark:text-slate-500">
                      Saldo zerado neste produto.
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}

          {/* Desktop Pivot Matrix Table (Caixinha × Produto) */}
          {nonZeroVehiclesForMatrix.length > 0 && nonZeroMatrixRows.length > 0 && (
            <section className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs md:block dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <h3 className="text-xs font-bold tracking-wide text-slate-700 uppercase dark:text-slate-300">
                  Matriz Caixinha × Produto
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <th className="px-4 py-2.5">Caixinha</th>
                      {nonZeroVehiclesForMatrix.map((v) => (
                        <th key={v.id} className="px-3 py-2.5 text-right whitespace-nowrap">
                          {v.name}
                        </th>
                      ))}
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {nonZeroMatrixRows.map((row) => (
                      <tr key={row.goalId}>
                        <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                          {row.goalName}
                        </td>
                        {nonZeroVehiclesForMatrix.map((v) => {
                          const cell = row.byVehicle[v.id];
                          return (
                            <td
                              key={v.id}
                              className={cn(
                                "px-3 py-2.5 text-right font-mono tabular-nums",
                                cell === undefined
                                  ? "text-slate-300 dark:text-slate-700"
                                  : cell < 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-slate-700 dark:text-slate-300"
                              )}
                            >
                              {cell === undefined ? "—" : maskBRL(cell, isPrivate)}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                          {maskBRL(row.totalBRL, isPrivate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50/70 font-bold dark:border-slate-700 dark:bg-slate-800/50">
                      <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">
                        Total geral
                      </td>
                      {nonZeroVehiclesForMatrix.map((v) => (
                        <td
                          key={v.id}
                          className={cn(
                            "px-3 py-2.5 text-right font-mono tabular-nums",
                            v.totalBRL < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-slate-900 dark:text-slate-100"
                          )}
                        >
                          {maskBRL(v.totalBRL, isPrivate)}
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-700 tabular-nums dark:text-emerald-400">
                        {maskBRL(summary.totalAllBalanceBRL, isPrivate)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* MODAL: CREATE / EDIT GOAL */}
      {goalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingGoal ? "Editar caixinha" : "Nova caixinha"}
              </h2>
              <button
                type="button"
                onClick={() => setGoalModalOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveGoal} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Nome da caixinha
                </label>
                <input
                  type="text"
                  required
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder="Ex.: Reserva de Emergência, Viagem, Reforma"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Valor-alvo (opcional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={goalTargetAmount}
                    onChange={(e) => setGoalTargetAmount(e.target.value)}
                    placeholder="Sem meta"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Prazo (opcional)
                  </label>
                  <input
                    type="date"
                    value={goalTargetDate}
                    onChange={(e) => setGoalTargetDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={goalIsReserve}
                  onChange={(e) => setGoalIsReserve(e.target.checked)}
                  className="h-4 w-4 rounded accent-teal-600"
                />
                <span>Marcar como Reserva de Emergência (integra à calculadora)</span>
              </label>

              {editingGoal && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={goalIsClosed}
                    onChange={(e) => setGoalIsClosed(e.target.checked)}
                    className="h-4 w-4 rounded accent-slate-600"
                  />
                  <span>Encerrar / arquivar esta caixinha</span>
                </label>
              )}

              <div className="flex items-center justify-between gap-2 pt-2">
                {editingGoal && editingGoal.movementCount === 0 ? (
                  <button
                    type="button"
                    onClick={() => handleDeleteGoal(editingGoal)}
                    className="inline-flex h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/60"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir
                  </button>
                ) : (
                  <span />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setGoalModalOpen(false)}
                    className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingGoal}
                    className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {savingGoal ? "Salvando..." : "Salvar"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NEW MOVEMENT (DEPOSIT | WITHDRAWAL | TRANSFER | YIELD) */}
      {movementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Movimentar caixinha
              </h2>
              <button
                type="button"
                onClick={() => setMovementModalOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 4-mode single-row selector */}
            <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 dark:border-slate-800 dark:bg-slate-950/60">
              {(
                [
                  { id: "DEPOSIT", label: "Aporte" },
                  { id: "WITHDRAWAL", label: "Resgate" },
                  { id: "TRANSFER", label: "Transferir" },
                  { id: "YIELD_ADJUSTMENT", label: "Rendimento" },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMovementMode(m.id)}
                  className={cn(
                    "whitespace-nowrap rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition",
                    movementMode === m.id
                      ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
                      : "text-slate-600 hover:text-slate-900 dark:text-slate-400"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSaveMovement} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {movementMode === "TRANSFER" ? "Caixinha de origem" : "Caixinha"}
                </label>
                <select
                  required
                  value={movGoalId}
                  onChange={(e) => setMovGoalId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {summary.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.isClosed ? " (encerrada)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {movementMode === "TRANSFER"
                      ? "Produto de origem"
                      : "Onde está investido"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuickVehicleOpen((v) => !v)}
                    className="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                  >
                    + Novo produto
                  </button>
                </div>

                {quickVehicleOpen && (
                  <div className="mb-2 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={quickVehicleName}
                      onChange={(e) => setQuickVehicleName(e.target.value)}
                      placeholder="Ex.: Tesouro Selic 2031"
                      className="h-9 flex-1 rounded-xl border border-emerald-300 bg-white px-3 text-xs text-slate-900 outline-none dark:border-emerald-800 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleQuickCreateVehicle}
                      disabled={savingQuickVehicle}
                      className="inline-flex h-9 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Criar
                    </button>
                  </div>
                )}

                <select
                  required
                  value={movVehicleId}
                  onChange={(e) => setMovVehicleId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {summary.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.isArchived ? " (arquivado)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              {movementMode === "TRANSFER" && (
                <div className="space-y-3 rounded-xl border border-sky-200/70 bg-sky-50/40 p-3 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Caixinha de destino
                    </label>
                    <select
                      required
                      value={movDestGoalId}
                      onChange={(e) => setMovDestGoalId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">Selecione...</option>
                      {summary.goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                      Produto de destino
                    </label>
                    <select
                      required
                      value={movDestVehicleId}
                      onChange={(e) => setMovDestVehicleId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">Selecione...</option>
                      {summary.vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {movementMode === "YIELD_ADJUSTMENT"
                      ? "Ajuste (+/- R$)"
                      : "Valor (R$)"}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={movAmount}
                    onChange={(e) => setMovAmount(e.target.value)}
                    placeholder={
                      movementMode === "YIELD_ADJUSTMENT" ? "Ex.: 45,20 ou -10" : "500,00"
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={movDate}
                    onChange={(e) => setMovDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Observações (opcional)
                </label>
                <input
                  type="text"
                  value={movNotes}
                  onChange={(e) => setMovNotes(e.target.value)}
                  placeholder="Ex.: Aporte do mês, troca de título..."
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMovementModalOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingMovement}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingMovement ? "Salvando..." : "Confirmar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: VEHICLE CREATE / EDIT */}
      {vehicleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingVehicle ? "Editar produto" : "Novo produto de custódia"}
              </h2>
              <button
                type="button"
                onClick={() => setVehicleModalOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveVehicle} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Nome do título / CDB
                </label>
                <input
                  type="text"
                  required
                  value={vehicleName}
                  onChange={(e) => setVehicleName(e.target.value)}
                  placeholder="Ex.: Tesouro Selic 2031, CDB Inter"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Instituição / corretora (opcional)
                </label>
                <input
                  type="text"
                  value={vehicleInstitution}
                  onChange={(e) => setVehicleInstitution(e.target.value)}
                  placeholder="Ex.: Inter, Itaú, XP, Tesouro Direto"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {editingVehicle && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={vehicleArchived}
                    onChange={(e) => setVehicleArchived(e.target.checked)}
                    className="h-4 w-4 rounded accent-slate-600"
                  />
                  <span>Arquivar produto (título vencido/resgatado)</span>
                </label>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingVehicle}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingVehicle ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EMERGENCY RESERVE CALCULATOR */}
      {calcModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Calculadora da Reserva de Emergência
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCalcModalOpen(false)}
                aria-label="Fechar"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Gasto mensal médio (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={calcMonthlyExpense}
                  onChange={(e) => setCalcMonthlyExpense(e.target.value)}
                  placeholder="20000"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Eventos para proteger (meta = maior cenário)
                  </span>
                  <button
                    type="button"
                    onClick={addCalculatorScenario}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-400"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Cenário
                  </button>
                </div>

                {calcScenarios.map((scenario, idx) => {
                  const evaluated = liveCalcPreview.scenarios[idx];
                  return (
                    <div
                      key={scenario.id}
                      className="space-y-2 rounded-xl border border-slate-200/80 p-3 dark:border-slate-800"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={scenario.label}
                          onChange={(e) =>
                            setCalcScenarios((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, label: e.target.value } : s
                              )
                            )
                          }
                          className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        {calcScenarios.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setCalcScenarios((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            aria-label="Remover cenário"
                            className="rounded-lg p-1 text-slate-400 hover:text-rose-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={scenario.mode}
                          onChange={(e) => {
                            const nextMode = e.target.value as "MONTHS" | "FIXED";
                            setCalcScenarios((prev) =>
                              prev.map((s, i) =>
                                i === idx
                                  ? {
                                      ...s,
                                      mode: nextMode,
                                      months: nextMode === "MONTHS" ? (s.months ?? 6) : null,
                                      fixedAmount:
                                        nextMode === "FIXED"
                                          ? (s.fixedAmount ?? 0)
                                          : null,
                                    }
                                  : s
                              )
                            );
                          }}
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        >
                          <option value="MONTHS">Meses de gasto</option>
                          <option value="FIXED">Valor fixo (R$)</option>
                        </select>

                        {scenario.mode === "MONTHS" ? (
                          <input
                            type="number"
                            min={0}
                            max={120}
                            value={scenario.months ?? 0}
                            onChange={(e) =>
                              setCalcScenarios((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? { ...s, months: Number(e.target.value) || 0 }
                                    : s
                                )
                              )
                            }
                            className="h-8 w-20 rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        ) : (
                          <input
                            type="number"
                            min={0}
                            step="100"
                            value={scenario.fixedAmount ?? 0}
                            onChange={(e) =>
                              setCalcScenarios((prev) =>
                                prev.map((s, i) =>
                                  i === idx
                                    ? {
                                        ...s,
                                        fixedAmount: Number(e.target.value) || 0,
                                      }
                                    : s
                                )
                              )
                            }
                            className="h-8 w-28 rounded-lg border border-slate-200 bg-white px-2 font-mono text-xs text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                          />
                        )}

                        <span className="ml-auto font-mono text-xs font-bold text-slate-800 tabular-nums dark:text-slate-200">
                          {maskBRL(evaluated?.computedAmountBRL ?? 0, isPrivate)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50/70 px-3.5 py-3 dark:border-teal-900/60 dark:bg-teal-950/30">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                  <span className="text-xs font-semibold text-teal-900 dark:text-teal-200">
                    Valor máximo da reserva
                  </span>
                </div>
                <span className="font-mono text-base font-bold text-teal-800 tabular-nums dark:text-teal-300">
                  {maskBRL(liveCalcPreview.recommendedTargetBRL, isPrivate)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSaveReserveCalculator(false)}
                  disabled={savingCalc}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Salvar cálculo
                </button>
                {summary.emergencyReserveGoal && (
                  <button
                    type="button"
                    onClick={() => handleSaveReserveCalculator(true)}
                    disabled={
                      savingCalc || liveCalcPreview.recommendedTargetBRL <= 0
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Aplicar na Reserva
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
