"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  Copy,
  Pencil,
  PiggyBank,
  Plus,
  Receipt,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  MONTHLY_ALLOCATION_KIND_LABELS,
  MONTHLY_EXPENSE_CATEGORY_LABELS,
  type MonthlyAllocationItem,
  type MonthlyAllocationKindKey,
  type MonthlyExpenseCategoryKey,
  type MonthlyExpenseWithShare,
  type MonthlyIncomeItem,
  formatMonthLongPtBR,
  formatMonthShortPtBR,
  getAdjacentYearMonth,
} from "@/lib/domain/monthly-budget";
import { formatPct } from "@/lib/domain/types";
import type { MonthlyBudgetPageData } from "@/lib/monthly-budget-loader";
import { CompactKpiStrip } from "@/components/compact-kpi-strip";
import { usePrivacy } from "@/components/privacy-provider";
import { maskBRL } from "@/lib/privacy";
import { cn } from "@/lib/utils";

interface MonthlyBudgetViewProps {
  initialData: MonthlyBudgetPageData;
}

type MonthlyTab = "EXPENSES" | "INCOMES" | "ALLOCATIONS";

function parseBrDecimal(raw: string): number {
  const cleaned = raw.trim().replace(/\s+/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : NaN;
}

function formatDatePtBR(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function getTodayDateInput(): string {
  return new Date().toLocaleDateString("en-CA");
}

function getCategoryBadgeClass(cat: MonthlyExpenseCategoryKey): string {
  switch (cat) {
    case "BILL":
      return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
    case "VARIABLE":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
    case "INVESTMENT":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "TAX":
      return "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
  }
}

export function MonthlyBudgetView({ initialData }: MonthlyBudgetViewProps) {
  const router = useRouter();
  const { isPrivate } = usePrivacy();

  const [data, setData] = useState<MonthlyBudgetPageData>(initialData);
  const [activeTab, setActiveTab] = useState<MonthlyTab>("EXPENSES");
  const [loadingMonth, setLoadingMonth] = useState(false);
  const [creatingMonth, setCreatingMonth] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState<string>(
    initialData.availableMonths[0]?.id ?? ""
  );

  // Inline checking balance edit
  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  // Feedback banner
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Income modal state
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [editingIncome, setEditingIncome] = useState<MonthlyIncomeItem | null>(
    null
  );
  const [incName, setIncName] = useState("");
  const [incAmount, setIncAmount] = useState("");
  const [incRecurring, setIncRecurring] = useState(true);
  const [savingIncome, setSavingIncome] = useState(false);

  // Expense modal state
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] =
    useState<MonthlyExpenseWithShare | null>(null);
  const [expName, setExpName] = useState("");
  const [expCategory, setExpCategory] =
    useState<MonthlyExpenseCategoryKey>("BILL");
  const [expAmount, setExpAmount] = useState("");
  const [expUnexpected, setExpUnexpected] = useState(false);
  const [expRecurring, setExpRecurring] = useState(true);
  const [savingExpense, setSavingExpense] = useState(false);

  // Allocation modal state
  const [allocModalOpen, setAllocModalOpen] = useState(false);
  const [editingAlloc, setEditingAlloc] =
    useState<MonthlyAllocationItem | null>(null);
  const [allocKind, setAllocKind] =
    useState<MonthlyAllocationKindKey>("SAVINGS_DEPOSIT");
  const [allocGoalId, setAllocGoalId] = useState("");
  const [allocName, setAllocName] = useState("");
  const [allocAmount, setAllocAmount] = useState("");
  const [allocRecurring, setAllocRecurring] = useState(true);
  const [savingAlloc, setSavingAlloc] = useState(false);

  // Assisted 1-click execute-to-savings modal
  const [executeAlloc, setExecuteAlloc] =
    useState<MonthlyAllocationItem | null>(null);
  const [execGoalId, setExecGoalId] = useState("");
  const [execVehicleId, setExecVehicleId] = useState("");
  const [execDate, setExecDate] = useState(getTodayDateInput());
  const [execAmount, setExecAmount] = useState("");
  const [execNotes, setExecNotes] = useState("");
  const [executingAlloc, setExecutingAlloc] = useState(false);
  const [quickVehicleOpen, setQuickVehicleOpen] = useState(false);
  const [quickVehicleName, setQuickVehicleName] = useState("");
  const [savingQuickVehicle, setSavingQuickVehicle] = useState(false);

  const budget = data.budget;
  const selectedLabelShort = formatMonthShortPtBR(
    data.selectedYear,
    data.selectedMonth
  );
  const selectedLabelLong = formatMonthLongPtBR(
    data.selectedYear,
    data.selectedMonth
  );

  async function loadMonth(year: number, month: number) {
    setLoadingMonth(true);
    setEditingBalance(false);
    try {
      const res = await fetch(
        `/api/monthly-budget?year=${year}&month=${month}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const next = (await res.json()) as MonthlyBudgetPageData;
        setData(next);
        if (!cloneSourceId && next.availableMonths[0]?.id) {
          setCloneSourceId(next.availableMonths[0].id);
        }
      }
    } finally {
      setLoadingMonth(false);
    }
  }

  async function reloadCurrentMonth() {
    await loadMonth(data.selectedYear, data.selectedMonth);
    router.refresh();
  }

  function handleStepMonth(delta: number) {
    const next = getAdjacentYearMonth(
      data.selectedYear,
      data.selectedMonth,
      delta
    );
    void loadMonth(next.year, next.month);
  }

  async function handleCreateMonth(withClone: boolean) {
    setCreatingMonth(true);
    setFeedback(null);
    try {
      const sourceId = withClone
        ? cloneSourceId || data.availableMonths[0]?.id || null
        : null;
      const res = await fetch("/api/monthly-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year: data.selectedYear,
          month: data.selectedMonth,
          cloneFromBudgetId: sourceId,
        }),
      });
      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: resData.error ?? "Erro ao criar o mês.",
        });
        return;
      }
      setData(resData as MonthlyBudgetPageData);
      setFeedback({
        type: "success",
        message: withClone
          ? `${selectedLabelShort} criado com itens recorrentes.`
          : `${selectedLabelShort} criado em branco.`,
      });
      router.refresh();
    } finally {
      setCreatingMonth(false);
    }
  }

  function startEditBalance() {
    if (!budget) return;
    setBalanceInput(String(budget.checkingBalance));
    setEditingBalance(true);
  }

  async function handleSaveBalance(event: React.FormEvent) {
    event.preventDefault();
    if (!budget) return;
    const numeric = parseBrDecimal(balanceInput);
    if (!Number.isFinite(numeric)) {
      setFeedback({ type: "error", message: "Saldo inválido." });
      return;
    }
    setSavingBalance(true);
    try {
      const res = await fetch(`/api/monthly-budget/${budget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkingBalance: numeric }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({
          type: "error",
          message: err.error ?? "Erro ao atualizar saldo.",
        });
        return;
      }
      setEditingBalance(false);
      await reloadCurrentMonth();
    } finally {
      setSavingBalance(false);
    }
  }

  // --- INCOMES ---
  function openIncomeModal(item?: MonthlyIncomeItem) {
    setEditingIncome(item ?? null);
    setIncName(item?.name ?? "");
    setIncAmount(item ? String(item.amount) : "");
    setIncRecurring(item?.isRecurring ?? true);
    setIncomeModalOpen(true);
  }

  async function handleSaveIncome(event: React.FormEvent) {
    event.preventDefault();
    if (!budget || !incName.trim()) return;
    const amount = parseBrDecimal(incAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setFeedback({ type: "error", message: "Valor de receita inválido." });
      return;
    }
    setSavingIncome(true);
    try {
      const url = editingIncome
        ? `/api/monthly-budget/incomes/${editingIncome.id}`
        : `/api/monthly-budget/${budget.id}/incomes`;
      const method = editingIncome ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: incName.trim(),
          amount,
          isRecurring: incRecurring,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({
          type: "error",
          message: err.error ?? "Erro ao salvar receita.",
        });
        return;
      }
      setIncomeModalOpen(false);
      await reloadCurrentMonth();
    } finally {
      setSavingIncome(false);
    }
  }

  async function handleToggleIncome(item: MonthlyIncomeItem) {
    const res = await fetch(`/api/monthly-budget/incomes/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isReceived: !item.isReceived }),
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  async function handleDeleteIncome(item: MonthlyIncomeItem) {
    if (!window.confirm(`Excluir a receita "${item.name}"?`)) return;
    const res = await fetch(`/api/monthly-budget/incomes/${item.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  // --- EXPENSES ---
  function openExpenseModal(item?: MonthlyExpenseWithShare, unexpected = false) {
    setEditingExpense(item ?? null);
    setExpName(item?.name ?? "");
    setExpCategory(item?.category ?? "BILL");
    setExpAmount(item ? String(item.amount) : "");
    setExpUnexpected(item?.isUnexpected ?? unexpected);
    setExpRecurring(item?.isRecurring ?? !unexpected);
    setExpenseModalOpen(true);
  }

  async function handleSaveExpense(event: React.FormEvent) {
    event.preventDefault();
    if (!budget || !expName.trim()) return;
    const amount = parseBrDecimal(expAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setFeedback({ type: "error", message: "Valor de despesa inválido." });
      return;
    }
    setSavingExpense(true);
    try {
      const url = editingExpense
        ? `/api/monthly-budget/expenses/${editingExpense.id}`
        : `/api/monthly-budget/${budget.id}/expenses`;
      const method = editingExpense ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: expName.trim(),
          category: expCategory,
          amount,
          isUnexpected: expUnexpected,
          isRecurring: expUnexpected ? false : expRecurring,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({
          type: "error",
          message: err.error ?? "Erro ao salvar despesa.",
        });
        return;
      }
      setExpenseModalOpen(false);
      await reloadCurrentMonth();
    } finally {
      setSavingExpense(false);
    }
  }

  async function handleToggleExpense(item: MonthlyExpenseWithShare) {
    const res = await fetch(`/api/monthly-budget/expenses/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPaid: !item.isPaid }),
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  async function handleDeleteExpense(item: MonthlyExpenseWithShare) {
    if (!window.confirm(`Excluir a despesa "${item.name}"?`)) return;
    const res = await fetch(`/api/monthly-budget/expenses/${item.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  // --- ALLOCATIONS ---
  function openAllocModal(
    item?: MonthlyAllocationItem,
    defaultKind: MonthlyAllocationKindKey = "SAVINGS_DEPOSIT"
  ) {
    const kind = item?.kind ?? defaultKind;
    setEditingAlloc(item ?? null);
    setAllocKind(kind);
    const firstGoalId =
      item?.savingsGoalId ?? data.activeSavingsGoals[0]?.id ?? "";
    setAllocGoalId(kind === "LONG_TERM_DEPOSIT" ? "" : firstGoalId);
    setAllocName(
      item?.name ??
        (kind === "LONG_TERM_DEPOSIT"
          ? "Longo prazo"
          : data.activeSavingsGoals.find((g) => g.id === firstGoalId)?.name ?? "")
    );
    setAllocAmount(item ? String(item.amount) : "");
    setAllocRecurring(item?.isRecurring ?? kind !== "SAVINGS_WITHDRAWAL");
    setAllocModalOpen(true);
  }

  async function handleSaveAlloc(event: React.FormEvent) {
    event.preventDefault();
    if (!budget) return;
    const amount = parseBrDecimal(allocAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setFeedback({ type: "error", message: "Valor inválido." });
      return;
    }
    setSavingAlloc(true);
    try {
      const url = editingAlloc
        ? `/api/monthly-budget/allocations/${editingAlloc.id}`
        : `/api/monthly-budget/${budget.id}/allocations`;
      const method = editingAlloc ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: allocKind,
          name: allocName.trim() || undefined,
          savingsGoalId:
            allocKind === "LONG_TERM_DEPOSIT" ? null : allocGoalId || null,
          amount,
          isRecurring: allocRecurring,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFeedback({
          type: "error",
          message: err.error ?? "Erro ao salvar item.",
        });
        return;
      }
      setAllocModalOpen(false);
      await reloadCurrentMonth();
    } finally {
      setSavingAlloc(false);
    }
  }

  async function handleToggleSimpleAllocation(item: MonthlyAllocationItem) {
    const res = await fetch(`/api/monthly-budget/allocations/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isExecuted: !item.isExecuted }),
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  async function handleDeleteAllocation(item: MonthlyAllocationItem) {
    if (!window.confirm(`Excluir "${item.name}" do plano do mês?`)) return;
    const res = await fetch(`/api/monthly-budget/allocations/${item.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      await reloadCurrentMonth();
    }
  }

  function openAssistedExecuteModal(item: MonthlyAllocationItem) {
    const goal =
      data.activeSavingsGoals.find((g) => g.id === item.savingsGoalId) ??
      data.activeSavingsGoals[0];
    const vehicleId =
      goal?.lastVehicleId ?? data.activeSavingsVehicles[0]?.id ?? "";

    setExecuteAlloc(item);
    setExecGoalId(item.savingsGoalId ?? goal?.id ?? "");
    setExecVehicleId(vehicleId);
    setExecDate(getTodayDateInput());
    setExecAmount(String(item.amount));
    setExecNotes("");
    setQuickVehicleOpen(false);
    setQuickVehicleName("");
  }

  async function handleQuickCreateVehicleInExec() {
    if (!quickVehicleName.trim()) return;
    setSavingQuickVehicle(true);
    try {
      const res = await fetch("/api/savings/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: quickVehicleName.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: body.error ?? "Erro ao criar produto.",
        });
        return;
      }
      const createdId = body.vehicle?.id as string | undefined;
      await reloadCurrentMonth();
      if (createdId) setExecVehicleId(createdId);
      setQuickVehicleName("");
      setQuickVehicleOpen(false);
    } finally {
      setSavingQuickVehicle(false);
    }
  }

  async function handleConfirmExecuteToSavings(event: React.FormEvent) {
    event.preventDefault();
    if (!executeAlloc) return;
    const amount = parseBrDecimal(execAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ type: "error", message: "Valor inválido." });
      return;
    }

    setExecutingAlloc(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/monthly-budget/allocations/${executeAlloc.id}/execute-to-savings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            goalId: execGoalId || undefined,
            vehicleId: execVehicleId,
            date: execDate,
            amount,
            notes: execNotes.trim() || null,
          }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: body.error ?? "Erro ao lançar na caixinha.",
        });
        return;
      }
      setExecuteAlloc(null);
      setFeedback({
        type: "success",
        message:
          executeAlloc.kind === "SAVINGS_WITHDRAWAL"
            ? "Saque registrado na caixinha e marcado no mês."
            : "Aporte registrado na caixinha e marcado no mês.",
      });
      await reloadCurrentMonth();
    } finally {
      setExecutingAlloc(false);
    }
  }

  async function handleMarkOnlyExecuted() {
    if (!executeAlloc) return;
    setExecutingAlloc(true);
    try {
      const res = await fetch(
        `/api/monthly-budget/allocations/${executeAlloc.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isExecuted: true }),
        }
      );
      if (res.ok) {
        setExecuteAlloc(null);
        await reloadCurrentMonth();
      }
    } finally {
      setExecutingAlloc(false);
    }
  }

  const renderExpenseRow = (exp: MonthlyExpenseWithShare) => (
    <div
      key={exp.id}
      className="flex items-center justify-between gap-2.5 px-4 py-3 transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={() => handleToggleExpense(exp)}
          aria-label={exp.isPaid ? `Desmarcar ${exp.name} como pago` : `Marcar ${exp.name} como pago`}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
            exp.isPaid
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-slate-300 bg-white hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900"
          )}
        >
          {exp.isPaid && <Check className="h-3 w-3 stroke-[3]" />}
        </button>

        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-xs font-semibold sm:text-sm",
              exp.isPaid
                ? "text-slate-400 line-through dark:text-slate-500"
                : "text-slate-900 dark:text-slate-100"
            )}
          >
            {exp.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-semibold",
                getCategoryBadgeClass(exp.category)
              )}
            >
              {MONTHLY_EXPENSE_CATEGORY_LABELS[exp.category]}
            </span>
            <span className="font-mono text-slate-400 tabular-nums dark:text-slate-500">
              {formatPct(exp.sharePct, 1)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn(
            "font-mono text-xs font-bold tabular-nums sm:text-sm",
            exp.isPaid
              ? "text-slate-400 dark:text-slate-500"
              : "text-slate-900 dark:text-slate-100"
          )}
        >
          {maskBRL(exp.amount, isPrivate)}
        </span>
        <button
          type="button"
          onClick={() => openExpenseModal(exp)}
          aria-label={`Editar ${exp.name}`}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleDeleteExpense(exp)}
          aria-label={`Excluir ${exp.name}`}
          className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header + Month Switcher */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
            Controle do Mês
          </h1>
          <span className="hidden rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 sm:inline dark:bg-amber-950/60 dark:text-amber-300">
            Hoje
          </span>
        </div>

        {/* Single-row Month Switcher */}
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => handleStepMonth(-1)}
            disabled={loadingMonth}
            aria-label="Mês anterior"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-[80px] text-center font-mono text-xs font-bold text-slate-800 tabular-nums dark:text-slate-100">
            {selectedLabelShort}
          </span>

          <button
            type="button"
            onClick={() => handleStepMonth(1)}
            disabled={loadingMonth}
            aria-label="Próximo mês"
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          >
            <ChevronRight className="h-4 w-4" />
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

      {/* EMPTY STATE: Month does not exist yet */}
      {!budget ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-900">
          <CalendarCheck2 className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-base font-bold text-slate-900 dark:text-slate-100">
            {selectedLabelLong} ainda não foi iniciado
          </h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            {data.availableMonths.length > 0
              ? "Clone seus itens recorrentes de um mês anterior (zerando status e inesperados) ou comece em branco."
              : "Crie este mês para acompanhar conta corrente, receitas, despesas e aportes."}
          </p>

          {data.availableMonths.length > 0 && (
            <div className="mx-auto mt-4 max-w-xs space-y-2.5">
              {data.availableMonths.length > 1 && (
                <select
                  aria-label="Mês de origem para clonagem"
                  value={cloneSourceId || data.availableMonths[0].id}
                  onChange={(e) => setCloneSourceId(e.target.value)}
                  className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {data.availableMonths.map((m) => (
                    <option key={m.id} value={m.id}>
                      Clonar recorrentes de {m.labelShort}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => handleCreateMonth(true)}
                disabled={creatingMonth}
                className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-60"
              >
                <Copy className="h-3.5 w-3.5" />
                {creatingMonth
                  ? "Criando..."
                  : `Criar clonando ${
                      data.availableMonths.find(
                        (m) => m.id === (cloneSourceId || data.availableMonths[0].id)
                      )?.labelShort ?? "mês anterior"
                    }`}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => handleCreateMonth(false)}
            disabled={creatingMonth}
            className={cn(
              "mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold transition-colors disabled:opacity-60",
              data.availableMonths.length > 0
                ? "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            )}
          >
            <Plus className="h-3.5 w-3.5" />
            Começar mês em branco
          </button>
        </section>
      ) : (
        <>
          {/* CHECKING BALANCE BAR + CASH FLOW KPIs */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2.5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Conta corrente
                  </span>
                  <span className="ml-2 text-[11px] text-slate-400 dark:text-slate-500">
                    {formatDatePtBR(budget.reportDate)}
                  </span>
                </div>
              </div>

              {editingBalance ? (
                <form
                  onSubmit={handleSaveBalance}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={balanceInput}
                    onChange={(e) => setBalanceInput(e.target.value)}
                    className="h-8 w-28 rounded-lg border border-emerald-400 bg-white px-2.5 font-mono text-xs font-bold text-slate-900 outline-none dark:border-emerald-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={savingBalance}
                    aria-label="Salvar saldo"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingBalance(false)}
                    aria-label="Cancelar edição do saldo"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={startEditBalance}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1 font-mono text-sm font-bold text-slate-900 tabular-nums transition-colors hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <span>{maskBRL(budget.checkingBalance, isPrivate)}</span>
                  <Pencil className="h-3 w-3 text-slate-400" />
                </button>
              )}
            </div>

            <CompactKpiStrip
              columns={4}
              items={[
                {
                  id: "real-cash",
                  label: "Dinheiro real",
                  value: maskBRL(budget.totals.realAvailableCashBRL, isPrivate),
                  icon: (
                    <Wallet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ),
                  subtext:
                    budget.totals.pendingSavingsWithdrawalsBRL > 0
                      ? `Incl. ${maskBRL(budget.totals.pendingSavingsWithdrawalsBRL, isPrivate)} saque`
                      : `A receber: ${maskBRL(budget.totals.pendingIncomeBRL, isPrivate)}`,
                },
                {
                  id: "pending-expenses",
                  label: "Falta pagar",
                  value: maskBRL(budget.totals.pendingExpensesBRL, isPrivate),
                  icon: (
                    <Receipt className="h-3.5 w-3.5 text-rose-500 dark:text-rose-400" />
                  ),
                  subtext: `Total mês: ${maskBRL(budget.totals.totalExpensesBRL, isPrivate)}`,
                },
                {
                  id: "surplus-before",
                  label: "Sobra (Lucro)",
                  value: maskBRL(
                    budget.totals.surplusBeforeInvestmentsBRL,
                    isPrivate
                  ),
                  icon: (
                    <TrendingUp className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                  ),
                  valueClassName:
                    budget.totals.surplusBeforeInvestmentsBRL < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : undefined,
                },
                {
                  id: "final-surplus",
                  label: "Sobra final",
                  value: maskBRL(budget.totals.finalSurplusBRL, isPrivate),
                  icon: (
                    <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ),
                  subtext: `A investir: ${maskBRL(budget.totals.pendingInvestmentsBRL, isPrivate)}`,
                  highlighted: true,
                  valueClassName:
                    budget.totals.finalSurplusBRL < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-700 dark:text-emerald-400",
                },
              ]}
            />

            {/* Discreet summary sub-line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
              <span>
                Receita:{" "}
                <strong className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  {maskBRL(budget.totals.totalIncomeBRL, isPrivate)}
                </strong>
              </span>
              <span>
                Líquida (s/ impostos):{" "}
                <strong className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                  {maskBRL(budget.totals.netIncomeBRL, isPrivate)}
                </strong>
              </span>
              {budget.totals.paidExpensesBRL > 0 && (
                <span>
                  Já pago:{" "}
                  <strong className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                    {maskBRL(budget.totals.paidExpensesBRL, isPrivate)}
                  </strong>
                </span>
              )}
            </div>
          </div>

          {/* Single-row 3-Tab Switcher */}
          <div className="grid w-full grid-cols-3 rounded-xl border border-slate-200 bg-slate-100/80 p-1 sm:inline-flex sm:w-auto dark:border-slate-800 dark:bg-slate-900">
            {(
              [
                {
                  id: "EXPENSES",
                  label: "Despesas",
                  pending: budget.totals.pendingExpenseCount,
                },
                {
                  id: "INCOMES",
                  label: "Receitas",
                  pending: budget.totals.pendingIncomeCount,
                },
                {
                  id: "ALLOCATIONS",
                  label: "Aportes",
                  pending: budget.totals.pendingAllocationCount,
                },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition sm:px-4",
                  activeTab === tab.id
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                )}
              >
                <span>{tab.label}</span>
                {tab.pending > 0 && (
                  <span className="rounded-full bg-slate-200/80 px-1.5 py-0.2 font-mono text-[10px] font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    {tab.pending}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* TAB: DESPESAS */}
          {activeTab === "EXPENSES" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Marque como pago conforme quitar para atualizar o caixa restante.
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openExpenseModal(undefined, true)}
                    className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Inesperado</span>
                    <span className="sm:hidden">Extra</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openExpenseModal(undefined, false)}
                    className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Despesa
                  </button>
                </div>
              </div>

              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                  <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Despesas do mês ({budget.regularExpenses.length})
                  </h2>
                  <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums dark:text-slate-400">
                    {maskBRL(
                      budget.regularExpenses.reduce((s, e) => s + e.amount, 0),
                      isPrivate
                    )}
                  </span>
                </div>

                {budget.regularExpenses.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                    Nenhuma despesa cadastrada neste mês.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {budget.regularExpenses.map(renderExpenseRow)}
                  </div>
                )}
              </section>

              {budget.unexpectedExpenses.length > 0 && (
                <section className="overflow-hidden rounded-2xl border border-amber-200/80 bg-white shadow-2xs dark:border-amber-900/50 dark:bg-slate-900">
                  <div className="flex items-center justify-between border-b border-amber-100 bg-amber-50/40 px-4 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <h2 className="text-xs font-bold text-amber-900 dark:text-amber-300">
                      Outros / Inesperados ({budget.unexpectedExpenses.length})
                    </h2>
                    <span className="font-mono text-xs font-semibold text-amber-800 tabular-nums dark:text-amber-300">
                      {maskBRL(
                        budget.unexpectedExpenses.reduce(
                          (s, e) => s + e.amount,
                          0
                        ),
                        isPrivate
                      )}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {budget.unexpectedExpenses.map(renderExpenseRow)}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* TAB: RECEITAS */}
          {activeTab === "INCOMES" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Marque como recebido quando cair na conta corrente (para não somar duas vezes).
                </p>
                <button
                  type="button"
                  onClick={() => openIncomeModal()}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Receita
                </button>
              </div>

              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                {budget.incomes.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                    Nenhuma receita cadastrada neste mês.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {budget.incomes.map((inc) => (
                      <div
                        key={inc.id}
                        className="flex items-center justify-between gap-2.5 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleToggleIncome(inc)}
                            aria-label={
                              inc.isReceived
                                ? `Desmarcar ${inc.name} como recebido`
                                : `Marcar ${inc.name} como recebido`
                            }
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                              inc.isReceived
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-slate-300 bg-white hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900"
                            )}
                          >
                            {inc.isReceived && (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <p
                              className={cn(
                                "truncate text-xs font-semibold sm:text-sm",
                                inc.isReceived
                                  ? "text-slate-400 line-through dark:text-slate-500"
                                  : "text-slate-900 dark:text-slate-100"
                              )}
                            >
                              {inc.name}
                            </p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500">
                              {inc.isReceived ? "Já na conta" : "A receber"}
                              {inc.isRecurring ? " · Recorrente" : " · Pontual"}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "font-mono text-xs font-bold tabular-nums sm:text-sm",
                              inc.isReceived
                                ? "text-slate-400 dark:text-slate-500"
                                : "text-emerald-700 dark:text-emerald-400"
                            )}
                          >
                            {maskBRL(inc.amount, isPrivate)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openIncomeModal(inc)}
                            aria-label={`Editar ${inc.name}`}
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteIncome(inc)}
                            aria-label={`Excluir ${inc.name}`}
                            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
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

          {/* TAB: APORTES E SAQUES */}
          {activeTab === "ALLOCATIONS" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Lance aportes/saques nas Caixinhas em 1 clique ou abra o Plano de Aporte.
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      openAllocModal(undefined, "SAVINGS_WITHDRAWAL")
                    }
                    className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5 text-amber-600" />
                    Saque
                  </button>
                  <button
                    type="button"
                    onClick={() => openAllocModal(undefined, "SAVINGS_DEPOSIT")}
                    className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Aporte
                  </button>
                </div>
              </div>

              {/* Aportes planejados */}
              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                  <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Objetivos e Investimentos ({budget.depositAllocations.length})
                  </h2>
                  <span className="font-mono text-xs font-semibold text-slate-500 tabular-nums dark:text-slate-400">
                    {maskBRL(budget.totals.plannedInvestmentsBRL, isPrivate)}
                  </span>
                </div>

                {budget.depositAllocations.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                    Nenhum aporte planejado neste mês.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {budget.depositAllocations.map((item) => {
                      const isLongTerm = item.kind === "LONG_TERM_DEPOSIT";
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2.5 px-4 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (isLongTerm || item.isExecuted) {
                                  if (!item.linkedMovementId) {
                                    void handleToggleSimpleAllocation(item);
                                  }
                                } else {
                                  openAssistedExecuteModal(item);
                                }
                              }}
                              aria-label={
                                item.isExecuted
                                  ? `${item.name} executado`
                                  : `Executar ${item.name}`
                              }
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                                item.isExecuted
                                  ? "border-emerald-600 bg-emerald-600 text-white"
                                  : "border-slate-300 bg-white hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900"
                              )}
                            >
                              {item.isExecuted && (
                                <Check className="h-3 w-3 stroke-[3]" />
                              )}
                            </button>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={cn(
                                    "truncate text-xs font-semibold sm:text-sm",
                                    item.isExecuted
                                      ? "text-slate-400 line-through dark:text-slate-500"
                                      : "text-slate-900 dark:text-slate-100"
                                  )}
                                >
                                  {item.name}
                                </span>
                                {item.linkedMovementId && (
                                  <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                                    Lançado ✓
                                  </span>
                                )}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                                <span>
                                  {isLongTerm
                                    ? "Carteira (Longo Prazo)"
                                    : item.savingsGoalName
                                      ? `Caixinha: ${item.savingsGoalName}`
                                      : "Caixinha"}
                                </span>
                                {isLongTerm && item.amount > 0 && (
                                  <Link
                                    href={`/aporte?valor=${item.amount}`}
                                    className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                                  >
                                    <Compass className="h-3 w-3" />
                                    Plano de Aporte
                                    <ArrowRight className="h-2.5 w-2.5" />
                                  </Link>
                                )}
                                {!isLongTerm && !item.isExecuted && item.amount > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => openAssistedExecuteModal(item)}
                                    className="inline-flex items-center gap-0.5 font-semibold text-teal-700 hover:underline dark:text-teal-400"
                                  >
                                    <PiggyBank className="h-3 w-3" />
                                    Lançar na caixinha
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-slate-900 tabular-nums sm:text-sm dark:text-slate-100">
                              {maskBRL(item.amount, isPrivate)}
                            </span>
                            <button
                              type="button"
                              onClick={() => openAllocModal(item)}
                              aria-label={`Editar ${item.name}`}
                              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteAllocation(item)}
                              aria-label={`Excluir ${item.name}`}
                              className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Resgates planejados (Para sacar de objetivos) */}
              <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5 dark:border-slate-800">
                  <h2 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Para sacar de objetivos ({budget.withdrawalAllocations.length})
                  </h2>
                  <span className="font-mono text-xs font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                    {maskBRL(budget.totals.totalSavingsWithdrawalsBRL, isPrivate)}
                  </span>
                </div>

                {budget.withdrawalAllocations.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    Nenhum saque de caixinhas planejado neste mês.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {budget.withdrawalAllocations.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2.5 px-4 py-3"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (item.isExecuted) {
                                if (!item.linkedMovementId) {
                                  void handleToggleSimpleAllocation(item);
                                }
                              } else {
                                openAssistedExecuteModal(item);
                              }
                            }}
                            aria-label={
                              item.isExecuted
                                ? `${item.name} sacado`
                                : `Registrar saque ${item.name}`
                            }
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                              item.isExecuted
                                ? "border-emerald-600 bg-emerald-600 text-white"
                                : "border-slate-300 bg-white hover:border-amber-500 dark:border-slate-600 dark:bg-slate-900"
                            )}
                          >
                            {item.isExecuted && (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </button>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={cn(
                                  "truncate text-xs font-semibold sm:text-sm",
                                  item.isExecuted
                                    ? "text-slate-400 line-through dark:text-slate-500"
                                    : "text-slate-900 dark:text-slate-100"
                                )}
                              >
                                {item.name}
                              </span>
                              {item.linkedMovementId && (
                                <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                                  Lançado ✓
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                              <span>
                                {item.isExecuted
                                  ? "Já sacado (na conta)"
                                  : "A sacar para cobrir caixa"}
                              </span>
                              {!item.isExecuted && item.amount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => openAssistedExecuteModal(item)}
                                  className="inline-flex items-center gap-0.5 font-semibold text-amber-700 hover:underline dark:text-amber-400"
                                >
                                  <ArrowDownLeft className="h-3 w-3" />
                                  Registrar saque
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-amber-700 tabular-nums sm:text-sm dark:text-amber-400">
                            +{maskBRL(item.amount, isPrivate)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openAllocModal(item)}
                            aria-label={`Editar ${item.name}`}
                            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAllocation(item)}
                            aria-label={`Excluir ${item.name}`}
                            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
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
        </>
      )}

      {/* MODAL: INCOME */}
      {incomeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingIncome ? "Editar receita" : "Nova receita"}
              </h2>
              <button
                type="button"
                onClick={() => setIncomeModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveIncome} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Descrição
                </label>
                <input
                  type="text"
                  required
                  value={incName}
                  onChange={(e) => setIncName(e.target.value)}
                  placeholder="Ex.: Remuneração meio mês, Reembolso"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Valor (R$)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  value={incAmount}
                  onChange={(e) => setIncAmount(e.target.value)}
                  placeholder="0,00"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={incRecurring}
                  onChange={(e) => setIncRecurring(e.target.checked)}
                  className="h-4 w-4 rounded accent-emerald-600"
                />
                <span>Recorrente (clonar para os próximos meses)</span>
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIncomeModalOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingIncome}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingIncome ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EXPENSE */}
      {expenseModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingExpense ? "Editar despesa" : "Nova despesa"}
              </h2>
              <button
                type="button"
                onClick={() => setExpenseModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveExpense} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Descrição
                </label>
                <input
                  type="text"
                  required
                  value={expName}
                  onChange={(e) => setExpName(e.target.value)}
                  placeholder="Ex.: Aluguel, Cartão de Crédito, DARF"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Categoria
                  </label>
                  <select
                    value={expCategory}
                    onChange={(e) =>
                      setExpCategory(e.target.value as MonthlyExpenseCategoryKey)
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {(
                      Object.keys(
                        MONTHLY_EXPENSE_CATEGORY_LABELS
                      ) as MonthlyExpenseCategoryKey[]
                    ).map((cat) => (
                      <option key={cat} value={cat}>
                        {MONTHLY_EXPENSE_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Valor (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={expAmount}
                    onChange={(e) => setExpAmount(e.target.value)}
                    placeholder="0,00"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={expUnexpected}
                  onChange={(e) => {
                    setExpUnexpected(e.target.checked);
                    if (e.target.checked) setExpRecurring(false);
                  }}
                  className="h-4 w-4 rounded accent-amber-600"
                />
                <span>Outros / Inesperados (gasto extra pontual do mês)</span>
              </label>
              {!expUnexpected && (
                <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={expRecurring}
                    onChange={(e) => setExpRecurring(e.target.checked)}
                    className="h-4 w-4 rounded accent-emerald-600"
                  />
                  <span>Recorrente (clonar para os próximos meses)</span>
                </label>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setExpenseModalOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingExpense}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingExpense ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ALLOCATION */}
      {allocModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {editingAlloc ? "Editar aporte / saque" : "Novo aporte / saque"}
              </h2>
              <button
                type="button"
                onClick={() => setAllocModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSaveAlloc} className="mt-4 space-y-3.5">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Tipo
                </label>
                <select
                  value={allocKind}
                  onChange={(e) => {
                    const nextKind = e.target.value as MonthlyAllocationKindKey;
                    setAllocKind(nextKind);
                    if (nextKind === "LONG_TERM_DEPOSIT") {
                      setAllocGoalId("");
                      if (!allocName.trim()) setAllocName("Longo prazo");
                    } else if (nextKind === "SAVINGS_WITHDRAWAL") {
                      setAllocRecurring(false);
                    }
                  }}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  {(
                    Object.keys(
                      MONTHLY_ALLOCATION_KIND_LABELS
                    ) as MonthlyAllocationKindKey[]
                  ).map((k) => (
                    <option key={k} value={k}>
                      {MONTHLY_ALLOCATION_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>

              {allocKind !== "LONG_TERM_DEPOSIT" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Caixinha vinculada
                  </label>
                  <select
                    value={allocGoalId}
                    onChange={(e) => {
                      setAllocGoalId(e.target.value);
                      const chosen = data.activeSavingsGoals.find(
                        (g) => g.id === e.target.value
                      );
                      if (chosen) setAllocName(chosen.name);
                    }}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="">Sem vínculo (definir depois)</option>
                    {data.activeSavingsGoals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Descrição
                  </label>
                  <input
                    type="text"
                    required
                    value={allocName}
                    onChange={(e) => setAllocName(e.target.value)}
                    placeholder="Ex.: Longo prazo"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Valor (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={allocAmount}
                    onChange={(e) => setAllocAmount(e.target.value)}
                    placeholder="500,00"
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200/80 px-3 py-2.5 text-xs font-medium text-slate-700 dark:border-slate-800 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={allocRecurring}
                  onChange={(e) => setAllocRecurring(e.target.checked)}
                  className="h-4 w-4 rounded accent-emerald-600"
                />
                <span>Recorrente (clonar para os próximos meses)</span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAllocModalOpen(false)}
                  className="h-9 rounded-xl border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingAlloc}
                  className="h-9 rounded-xl bg-emerald-600 px-4 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingAlloc ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ASSISTED 1-CLICK EXECUTE TO CAIXINHAS */}
      {executeAlloc && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-xs sm:items-center sm:p-4 dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <PiggyBank className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {executeAlloc.kind === "SAVINGS_WITHDRAWAL"
                    ? "Lançar saque na Caixinha"
                    : "Lançar aporte na Caixinha"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setExecuteAlloc(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmExecuteToSavings}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Caixinha
                </label>
                <select
                  required
                  value={execGoalId}
                  onChange={(e) => setExecGoalId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {data.activeSavingsGoals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Produto / título
                  </label>
                  <button
                    type="button"
                    onClick={() => setQuickVehicleOpen((v) => !v)}
                    className="text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-400"
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
                      className="h-9 flex-1 rounded-xl border border-teal-300 bg-white px-3 text-xs text-slate-900 outline-none dark:border-teal-800 dark:bg-slate-800 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleQuickCreateVehicleInExec}
                      disabled={savingQuickVehicle}
                      className="inline-flex h-9 items-center gap-1 rounded-xl bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700"
                    >
                      Criar
                    </button>
                  </div>
                )}

                <select
                  required
                  value={execVehicleId}
                  onChange={(e) => setExecVehicleId(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                >
                  <option value="">Selecione...</option>
                  {data.activeSavingsVehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Valor (R$)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={execAmount}
                    onChange={(e) => setExecAmount(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={execDate}
                    onChange={(e) => setExecDate(e.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Observações (opcional)
                </label>
                <input
                  type="text"
                  value={execNotes}
                  onChange={(e) => setExecNotes(e.target.value)}
                  placeholder={`Via Controle de ${selectedLabelShort}`}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-teal-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="submit"
                  disabled={executingAlloc || !execGoalId || !execVehicleId}
                  className="h-10 w-full rounded-xl bg-teal-600 px-4 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {executingAlloc
                    ? "Lançando..."
                    : "Confirmar e lançar na Caixinha"}
                </button>
                <button
                  type="button"
                  onClick={handleMarkOnlyExecuted}
                  disabled={executingAlloc}
                  className="h-9 w-full rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Apenas marcar como executado no mês
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
