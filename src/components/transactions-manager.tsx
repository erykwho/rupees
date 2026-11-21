"use client";

import { Fragment, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  ALL_ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  type AssetClassKey,
  type CurrencyCode,
  FIXED_INCOME_INDEX_LABELS,
  type FixedIncomeIndexKey,
  type TransactionTypeKey,
  formatCurrency,
  isFixedIncomeClass,
} from "@/lib/domain/types";
import { usePrivacy } from "@/components/privacy-provider";
import { maskCurrency, maskQty } from "@/lib/privacy";
import { cn } from "@/lib/utils";

export interface TransactionRow {
  id: string;
  assetId: string;
  date: string;
  type: TransactionTypeKey;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  fixedIncomeRate?: number | null;
  notes: string | null;
  asset: {
    id: string;
    ticker: string;
    assetClass: AssetClassKey;
    currency: CurrencyCode;
    sector: string;
    fixedIncomeIndex?: FixedIncomeIndexKey | null;
    fixedIncomeRate?: number | null;
  };
}

export interface SimpleAssetOption {
  id: string;
  ticker: string;
  assetClass: AssetClassKey;
  currency: CurrencyCode;
  fixedIncomeIndex?: FixedIncomeIndexKey | null;
  fixedIncomeRate?: number | null;
}

interface TransactionsManagerProps {
  initialTransactions: TransactionRow[];
  assets: SimpleAssetOption[];
  openNewByDefault?: boolean;
}

interface TxFormState {
  id?: string;
  assetId: string;
  date: string;
  type: TransactionTypeKey;
  quantity: string;
  unitPrice: string;
  totalAmount: string;
  fixedIncomeRate: string;
  notes: string;
}

export function TransactionsManager({
  initialTransactions,
  assets,
  openNewByDefault = false,
}: TransactionsManagerProps) {
  const { isPrivate } = usePrivacy();
  const [transactions, setTransactions] =
    useState<TransactionRow[]>(initialTransactions);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TransactionTypeKey | "ALL">(
    "ALL"
  );
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(
    openNewByDefault && assets.length > 0
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [assetClassFilter, setAssetClassFilter] = useState<
    AssetClassKey | "ALL"
  >("ALL");

  const [form, setForm] = useState<TxFormState>({
    assetId: "",
    date: new Date().toISOString().slice(0, 10),
    type: "BUY",
    quantity: "",
    unitPrice: "",
    totalAmount: "",
    fixedIncomeRate: "",
    notes: "",
  });

  const availableClasses = useMemo(
    () =>
      ALL_ASSET_CLASSES.filter((cls) =>
        assets.some((a) => a.assetClass === cls)
      ),
    [assets]
  );

  const filteredAssets = useMemo(
    () =>
      assetClassFilter === "ALL"
        ? assets
        : assets.filter((a) => a.assetClass === assetClassFilter),
    [assets, assetClassFilter]
  );

  const selectedAsset = assets.find((a) => a.id === form.assetId);
  const showFixedIncomeRateInput =
    form.type === "BUY" &&
    selectedAsset !== undefined &&
    isFixedIncomeClass(selectedAsset.assetClass);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
      if (
        q &&
        !t.asset.ticker.toLowerCase().includes(q) &&
        !(t.notes ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [transactions, query, typeFilter]);

  async function reloadTransactions() {
    const res = await fetch("/api/transactions");
    if (res.ok) {
      const data = await res.json();
      setTransactions(data.transactions);
    }
  }

  function openCreateModal() {
    setError(null);
    setAssetClassFilter("ALL");
    setForm({
      assetId: "",
      date: new Date().toISOString().slice(0, 10),
      type: "BUY",
      quantity: "",
      unitPrice: "",
      totalAmount: "",
      fixedIncomeRate: "",
      notes: "",
    });
    setModalOpen(true);
  }

  function openEditModal(tx: TransactionRow) {
    setError(null);
    setAssetClassFilter(tx.asset.assetClass);
    setForm({
      id: tx.id,
      assetId: tx.assetId,
      date: tx.date.slice(0, 10),
      type: tx.type,
      quantity: String(tx.quantity),
      unitPrice: String(tx.unitPrice),
      totalAmount: String(tx.totalAmount),
      fixedIncomeRate:
        tx.fixedIncomeRate !== undefined && tx.fixedIncomeRate !== null
          ? String(tx.fixedIncomeRate)
          : "",
      notes: tx.notes ?? "",
    });
    setModalOpen(true);
  }

  function handleQtyOrPriceChange(field: "quantity" | "unitPrice", value: string) {
    const next = { ...form, [field]: value };
    const q = Number(next.quantity.replace(",", "."));
    const p = Number(next.unitPrice.replace(",", "."));
    if (Number.isFinite(q) && Number.isFinite(p) && q !== 0 && p > 0) {
      next.totalAmount = (q * p).toFixed(2);
    }
    setForm(next);
  }

  function handleTotalChange(value: string) {
    const next = { ...form, totalAmount: value };
    const q = Number(next.quantity.replace(",", "."));
    const t = Number(value.replace(",", "."));
    if (Number.isFinite(q) && Number.isFinite(t) && q !== 0 && t > 0) {
      next.unitPrice = (t / Math.abs(q)).toFixed(4);
    }
    setForm(next);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const parsedLotRate = form.fixedIncomeRate.trim()
        ? Number(form.fixedIncomeRate.replace(",", "."))
        : null;

      const payload = {
        assetId: form.assetId,
        date: form.date,
        type: form.type,
        quantity: Number(form.quantity.replace(",", ".")),
        unitPrice: Number(form.unitPrice.replace(",", ".")) || 0,
        totalAmount: Number(form.totalAmount.replace(",", ".")) || 0,
        fixedIncomeRate:
          showFixedIncomeRateInput &&
          parsedLotRate !== null &&
          Number.isFinite(parsedLotRate)
            ? parsedLotRate
            : null,
        notes: form.notes.trim() || null,
      };

      const url = form.id
        ? `/api/transactions/${form.id}`
        : "/api/transactions";
      const method = form.id ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao salvar lançamento.");
        return;
      }

      setModalOpen(false);
      await reloadTransactions();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(tx: TransactionRow) {
    const confirmed = window.confirm(
      `Remover lançamento de ${tx.asset.ticker} em ${new Date(tx.date).toLocaleDateString("pt-BR")}?`
    );
    if (!confirmed) return;

    const res = await fetch(`/api/transactions/${tx.id}`, { method: "DELETE" });
    if (res.ok) {
      setTransactions((prev) => prev.filter((item) => item.id !== tx.id));
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Lançamentos
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Histórico completo de compras, vendas e ajustes de saldo (
            {transactions.length} registros).
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          disabled={assets.length === 0}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Novo lançamento
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["ALL", "Todos"],
              ["BUY", "Compras"],
              ["SELL", "Vendas"],
              ["BALANCE_ADJUSTMENT", "Ajustes"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTypeFilter(key)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                typeFilter === key
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar por ticker ou nota..."
            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Transactions List */}
      <div className="-mx-4 overflow-hidden border-y border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:-mx-6 md:mx-0 md:rounded-2xl md:border">
        {/* Mobile Compact 3-Column Accordion Table */}
        <div className="md:hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-3 pl-3 pr-1.5">Ativo / Data</th>
                <th className="px-1.5 py-3">Tipo</th>
                <th className="py-3 pl-1.5 pr-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500"
                  >
                    Nenhum lançamento encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const isExpanded = expandedTxId === tx.id;
                  const toggleExpanded = () =>
                    setExpandedTxId((prev) => (prev === tx.id ? null : tx.id));
                  const formattedDate = new Date(tx.date).toLocaleDateString(
                    "pt-BR",
                    { timeZone: "UTC" }
                  );
                  const isFixedOrAdjustment =
                    isFixedIncomeClass(tx.asset.assetClass) ||
                    tx.type === "BALANCE_ADJUSTMENT";

                  return (
                    <Fragment key={tx.id}>
                      <tr
                        onClick={toggleExpanded}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50",
                          isExpanded && "bg-slate-50/60 dark:bg-slate-800/40"
                        )}
                      >
                        <td className="py-3 pl-3 pr-1.5 align-top">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Recolher" : "Expandir"} detalhes do lançamento de ${tx.asset.ticker}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded();
                            }}
                            className="inline-flex items-center gap-1 text-left font-mono font-bold text-slate-900 focus:outline-none dark:text-slate-100"
                          >
                            <span>{tx.asset.ticker}</span>
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500",
                                isExpanded &&
                                  "rotate-180 text-emerald-600 dark:text-emerald-400"
                              )}
                            />
                          </button>
                          <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            {formattedDate}
                          </p>
                        </td>

                        <td className="whitespace-nowrap px-1.5 py-3 align-top">
                          {tx.type === "BUY" && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              <ArrowDownLeft className="h-3 w-3" />
                              Compra
                            </span>
                          )}
                          {tx.type === "SELL" && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                              <ArrowUpRight className="h-3 w-3" />
                              Venda
                            </span>
                          )}
                          {tx.type === "BALANCE_ADJUSTMENT" && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                              <SlidersHorizontal className="h-3 w-3" />
                              Ajuste
                            </span>
                          )}
                        </td>

                        <td className="whitespace-nowrap py-3 pl-1.5 pr-3 text-right align-top font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {maskCurrency(
                            tx.totalAmount,
                            tx.asset.currency,
                            isPrivate
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/90 dark:bg-slate-800/40">
                          <td colSpan={3} className="px-3 py-3">
                            {!isFixedOrAdjustment && (
                              <div className="mb-3 grid grid-cols-2 gap-3 font-mono tabular-nums">
                                <div>
                                  <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                                    Quantidade
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {maskQty(
                                      tx.quantity,
                                      isPrivate,
                                      tx.asset.assetClass
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                                    Preço Unit.
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {formatCurrency(
                                      tx.unitPrice,
                                      tx.asset.currency
                                    )}
                                  </p>
                                </div>
                              </div>
                            )}

                            {tx.notes && (
                              <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">
                                <span className="font-medium text-slate-500 dark:text-slate-400">
                                  Nota:{" "}
                                </span>
                                {tx.notes}
                              </p>
                            )}

                            <div
                              className={cn(
                                "flex flex-wrap items-center justify-between gap-2",
                                (!isFixedOrAdjustment || Boolean(tx.notes)) &&
                                  "border-t border-slate-200/70 pt-2.5 dark:border-slate-700/70"
                              )}
                            >
                              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                {ASSET_CLASS_LABELS[tx.asset.assetClass]}
                              </span>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditModal(tx);
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(tx);
                                  }}
                                  aria-label={`Remover lançamento de ${tx.asset.ticker}`}
                                  title="Remover lançamento"
                                  className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500 dark:hover:border-rose-900/60 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Desktop / Tablet 6-Column Table */}
        <div className="hidden md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-3 pl-4 pr-2 xl:pl-5 xl:pr-3">Data</th>
                <th className="px-2 py-3 xl:px-3">Ativo</th>
                <th className="px-2 py-3 xl:px-3">Tipo</th>
                <th className="px-2 py-3 text-right xl:px-3">Qtd / Preço</th>
                <th className="px-2 py-3 text-right xl:px-3">Total</th>
                <th className="py-3 pl-2 pr-4 text-right xl:pl-3 xl:pr-5">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-slate-400 dark:text-slate-500"
                  >
                    Nenhum lançamento encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((tx) => {
                  const isFixedOrAdjustment =
                    isFixedIncomeClass(tx.asset.assetClass) ||
                    tx.type === "BALANCE_ADJUSTMENT";

                  return (
                    <tr
                      key={tx.id}
                      className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                    >
                      <td className="whitespace-nowrap py-3.5 pl-4 pr-2 font-mono text-xs text-slate-600 tabular-nums dark:text-slate-400 xl:pl-5 xl:pr-3">
                        {new Date(tx.date).toLocaleDateString("pt-BR", {
                          timeZone: "UTC",
                        })}
                      </td>
                      <td className="px-2 py-3.5 xl:px-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {tx.asset.ticker}
                          </span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {ASSET_CLASS_LABELS[tx.asset.assetClass]}
                          </span>
                        </div>
                        {tx.notes && (
                          <p
                            title={tx.notes}
                            className="mt-0.5 max-w-[170px] truncate text-xs text-slate-400 dark:text-slate-500 xl:max-w-[260px]"
                          >
                            {tx.notes}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3.5 xl:px-3">
                        {tx.type === "BUY" && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                            <ArrowDownLeft className="h-3 w-3" />
                            Compra
                          </span>
                        )}
                        {tx.type === "SELL" && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                            <ArrowUpRight className="h-3 w-3" />
                            Venda
                          </span>
                        )}
                        {tx.type === "BALANCE_ADJUSTMENT" && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                            <SlidersHorizontal className="h-3 w-3" />
                            Ajuste
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono tabular-nums xl:px-3">
                        <div className="text-slate-700 dark:text-slate-300">
                          {maskQty(tx.quantity, isPrivate, tx.asset.assetClass)}
                        </div>
                        {!isFixedOrAdjustment && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {formatCurrency(tx.unitPrice, tx.asset.currency)}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100 xl:px-3">
                        {maskCurrency(
                          tx.totalAmount,
                          tx.asset.currency,
                          isPrivate
                        )}
                      </td>
                      <td className="whitespace-nowrap py-3.5 pl-2 pr-4 text-right xl:pl-3 xl:pr-5">
                        <div className="inline-flex items-center gap-0.5 xl:gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(tx)}
                            title="Editar lançamento"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(tx)}
                            title="Remover lançamento"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Transaction Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {form.id ? "Editar lançamento" : "Novo lançamento"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Classe
                  </label>
                  <select
                    value={assetClassFilter}
                    onChange={(e) => {
                      const nextClass = e.target.value as
                        | AssetClassKey
                        | "ALL";
                      setAssetClassFilter(nextClass);
                      setForm((prev) => ({
                        ...prev,
                        assetId: "",
                      }));
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="ALL">Todas as classes</option>
                    {availableClasses.map((cls) => (
                      <option key={cls} value={cls}>
                        {ASSET_CLASS_LABELS[cls]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Ativo
                  </label>
                  <select
                    required
                    value={form.assetId}
                    onChange={(e) => {
                      const nextAsset = assets.find(
                        (a) => a.id === e.target.value
                      );
                      const isFixed = nextAsset
                        ? isFixedIncomeClass(nextAsset.assetClass)
                        : false;
                      setForm((prev) => ({
                        ...prev,
                        assetId: e.target.value,
                        unitPrice: isFixed ? "1" : prev.unitPrice,
                      }));
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="" disabled>
                      Selecione um ativo...
                    </option>
                    {filteredAssets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetClassFilter === "ALL"
                          ? `${a.ticker} (${ASSET_CLASS_LABELS[a.assetClass]})`
                          : a.ticker}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tipo
                  </label>
                  <select
                    value={form.type}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        type: e.target.value as TransactionTypeKey,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="BUY">Compra / Aporte</option>
                    <option value="SELL">Venda / Resgate</option>
                    <option value="BALANCE_ADJUSTMENT">Ajuste de Saldo</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Data
                  </label>
                  <input
                    required
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Quantidade
                  </label>
                  <input
                    required
                    type="number"
                    step="any"
                    value={form.quantity}
                    onChange={(e) =>
                      handleQtyOrPriceChange("quantity", e.target.value)
                    }
                    placeholder="10"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Preço ({selectedAsset?.currency ?? "BRL"})
                  </label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={form.unitPrice}
                    onChange={(e) =>
                      handleQtyOrPriceChange("unitPrice", e.target.value)
                    }
                    placeholder="50.00"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Total ({selectedAsset?.currency ?? "BRL"})
                  </label>
                  <input
                    required
                    type="number"
                    step="any"
                    value={form.totalAmount}
                    onChange={(e) => handleTotalChange(e.target.value)}
                    placeholder="500.00"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              {showFixedIncomeRateInput && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Taxa contratada do lote (%) — opcional
                    {selectedAsset?.fixedIncomeIndex
                      ? ` (${FIXED_INCOME_INDEX_LABELS[selectedAsset.fixedIncomeIndex]})`
                      : ""}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.fixedIncomeRate}
                    onChange={(e) =>
                      setForm({ ...form, fixedIncomeRate: e.target.value })
                    }
                    placeholder={
                      selectedAsset?.fixedIncomeRate != null
                        ? `Padrão do ativo: ${selectedAsset.fixedIncomeRate}%`
                        : "Deixe em branco para usar a taxa padrão do ativo"
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Observação (opcional)
                </label>
                <input
                  type="text"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Ex: Aporte mensal, reinvestimento..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {saving ? "Salvando..." : "Salvar lançamento"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
