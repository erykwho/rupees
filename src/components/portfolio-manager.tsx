"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import {
  ALL_ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  INVESTMENT_CLASSES,
  type AssetClassKey,
  type AssetSummary,
  FIXED_INCOME_INDEXES,
  FIXED_INCOME_INDEX_LABELS,
  type FixedIncomeIndexKey,
  type InvestmentClassKey,
  type PortfolioSummary,
  type PriceModeKey,
  formatBRL,
  formatCurrency,
  formatPct,
  isFixedIncomeClass,
} from "@/lib/domain/types";
import { usePrivacy } from "@/components/privacy-provider";
import { useTheme } from "@/components/theme-provider";
import { maskBRL, maskQty } from "@/lib/privacy";
import { cn } from "@/lib/utils";

const SECTOR_PALETTE = [
  "#059669",
  "#0284c7",
  "#2563eb",
  "#d97706",
  "#0f766e",
  "#4f46e5",
  "#db2777",
  "#65a30d",
  "#0891b2",
  "#ea580c",
  "#64748b",
  "#10b981",
];

const SECTOR_CLASSES: InvestmentClassKey[] = INVESTMENT_CLASSES.filter(
  (c) => c !== "FIXED_INCOME"
);

interface PortfolioManagerProps {
  initialSummary: PortfolioSummary;
}

interface AssetFormState {
  id?: string;
  ticker: string;
  assetClass: AssetClassKey;
  sector: string;
  targetPctInClass: string;
  priceMode: PriceModeKey;
  manualPrice: string;
  isActive: boolean;
  fixedIncomeIndex: FixedIncomeIndexKey | "";
  fixedIncomeRate: string;
  maturityDate: string;
  taxExempt: boolean;
}

const EMPTY_FORM: AssetFormState = {
  ticker: "",
  assetClass: "BR_STOCK",
  sector: "",
  targetPctInClass: "0",
  priceMode: "AUTO_YAHOO",
  manualPrice: "",
  isActive: true,
  fixedIncomeIndex: "",
  fixedIncomeRate: "",
  maturityDate: "",
  taxExempt: false,
};

export function PortfolioManager({ initialSummary }: PortfolioManagerProps) {
  const { theme } = useTheme();
  const { isPrivate } = usePrivacy();
  const isDark = theme === "dark";

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [selectedClass, setSelectedClass] = useState<AssetClassKey | "ALL">(
    "ALL"
  );
  const [selectedSectorClass, setSelectedSectorClass] =
    useState<InvestmentClassKey>("BR_STOCK");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  function handleSelectClass(cls: AssetClassKey | "ALL") {
    setSelectedClass(cls);
    if (cls !== "ALL" && SECTOR_CLASSES.includes(cls as InvestmentClassKey)) {
      setSelectedSectorClass(cls as InvestmentClassKey);
    }
  }

  const sectorData = useMemo(
    () =>
      summary.sectors
        .filter(
          (s) => s.assetClass === selectedSectorClass && s.currentValueBRL > 0
        )
        .map((s) => ({
          name: s.sector,
          value: Number(s.currentValueBRL.toFixed(2)),
          pct: Number(s.actualPctInClass.toFixed(1)),
        })),
    [summary.sectors, selectedSectorClass]
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

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AssetFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick balance update modal for Fixed Income / Emergency Reserve
  const [balanceModalAsset, setBalanceModalAsset] =
    useState<AssetSummary | null>(null);
  const [newBalanceValue, setNewBalanceValue] = useState("");
  const [savingBalance, setSavingBalance] = useState(false);

  async function reloadPortfolio() {
    const res = await fetch("/api/portfolio");
    if (res.ok) {
      const data = await res.json();
      setSummary(data.summary);
    }
  }

  const filteredAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return summary.assets
      .filter((a) => {
        if (!showInactive && !a.isActive) return false;
        if (selectedClass !== "ALL" && a.assetClass !== selectedClass)
          return false;
        if (
          q &&
          !a.ticker.toLowerCase().includes(q) &&
          !a.sector.toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.currentValueBRL - a.currentValueBRL);
  }, [summary.assets, selectedClass, query, showInactive]);

  const classTargetIssues = useMemo(() => {
    return summary.classes.filter(
      (c) => Math.abs(c.targetSumInClass - 100) > 0.05 && c.targetPct > 0
    );
  }, [summary.classes]);

  function openCreateModal() {
    setError(null);
    const defaultClass = selectedClass === "ALL" ? "BR_STOCK" : selectedClass;
    const isFixed = isFixedIncomeClass(defaultClass);
    setForm({
      ...EMPTY_FORM,
      assetClass: defaultClass,
      priceMode: isFixed ? "MANUAL" : "AUTO_YAHOO",
      manualPrice: isFixed ? "1" : "",
    });
    setModalOpen(true);
  }

  function openEditModal(asset: AssetSummary) {
    setError(null);
    setForm({
      id: asset.id,
      ticker: asset.ticker,
      assetClass: asset.assetClass,
      sector: asset.sector,
      targetPctInClass: String(asset.targetPctInClass),
      priceMode: asset.priceMode,
      manualPrice: asset.manualPrice !== null ? String(asset.manualPrice) : "",
      isActive: asset.isActive,
      fixedIncomeIndex: asset.fixedIncomeIndex ?? "",
      fixedIncomeRate:
        asset.fixedIncomeRate !== null ? String(asset.fixedIncomeRate) : "",
      maturityDate: asset.maturityDate ?? "",
      taxExempt: asset.taxExempt,
    });
    setModalOpen(true);
  }

  async function handleSaveAsset(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const isFixed = isFixedIncomeClass(form.assetClass);
      const parsedFiRate = form.fixedIncomeRate.trim()
        ? Number(form.fixedIncomeRate.replace(",", "."))
        : null;

      const payload = {
        ticker: form.ticker.trim().toUpperCase(),
        assetClass: form.assetClass,
        sector: form.sector.trim() || "Outros",
        targetPctInClass: Number(form.targetPctInClass.replace(",", ".")) || 0,
        priceMode: form.priceMode,
        manualPrice:
          form.priceMode === "MANUAL" && form.manualPrice
            ? Number(form.manualPrice.replace(",", "."))
            : null,
        isActive: form.isActive,
        fixedIncomeIndex:
          isFixed && form.fixedIncomeIndex ? form.fixedIncomeIndex : null,
        fixedIncomeRate:
          isFixed && parsedFiRate !== null && Number.isFinite(parsedFiRate)
            ? parsedFiRate
            : null,
        maturityDate: isFixed && form.maturityDate ? form.maturityDate : null,
        taxExempt: isFixed ? form.taxExempt : false,
      };

      const url = form.id ? `/api/assets/${form.id}` : "/api/assets";
      const method = form.id ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Erro ao salvar ativo.");
        return;
      }

      setModalOpen(false);
      await reloadPortfolio();
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAsset(asset: AssetSummary) {
    const confirmed = window.confirm(
      `Excluir ${asset.ticker} e todos os seus lançamentos? Se preferir manter o histórico, edite o ativo e desmarque "Ativo na carteira".`
    );
    if (!confirmed) return;

    const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    if (res.ok) {
      await reloadPortfolio();
    }
  }

  function openBalanceModal(asset: AssetSummary) {
    setBalanceModalAsset(asset);
    setNewBalanceValue(asset.currentValueBRL.toFixed(2));
  }

  async function handleUpdateFixedIncomeBalance(e: React.FormEvent) {
    e.preventDefault();
    if (!balanceModalAsset) return;
    setSavingBalance(true);
    try {
      const targetVal = Number(newBalanceValue.replace(",", "."));
      if (!Number.isFinite(targetVal) || targetVal < 0) return;

      const delta = Number(
        (targetVal - balanceModalAsset.currentValueBRL).toFixed(4)
      );
      if (Math.abs(delta) < 0.01) {
        setBalanceModalAsset(null);
        return;
      }

      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: balanceModalAsset.id,
          date: new Date().toISOString().slice(0, 10),
          type: "BALANCE_ADJUSTMENT",
          quantity: delta,
          unitPrice: 1,
          totalAmount: delta,
          notes: "Atualização manual de saldo / rendimento",
        }),
      });

      if (res.ok) {
        setBalanceModalAsset(null);
        await reloadPortfolio();
      }
    } finally {
      setSavingBalance(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Carteira
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Gerencie seus ativos, setores, percentuais alvo e saldos de Renda
            Fixa.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Adicionar ativo
        </button>
      </div>

      {/* Target Sum Validation Banner */}
      {classTargetIssues.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="font-semibold">
                Atenção: soma dos objetivos dentro da classe diferente de 100%
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {classTargetIssues.map((c) => (
                  <span
                    key={c.assetClass}
                    className="rounded-lg bg-white/80 px-2.5 py-1 font-mono font-semibold text-amber-800 dark:bg-slate-900/80 dark:text-amber-300"
                  >
                    {c.label}: {formatPct(c.targetSumInClass, 2)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Todas as classes de investimento fecham em 100% de alocação alvo.
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleSelectClass("ALL")}
            className={cn(
              "rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
              selectedClass === "ALL"
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            Todas
          </button>
          {ALL_ASSET_CLASSES.map((cls) => (
            <button
              key={cls}
              type="button"
              onClick={() => handleSelectClass(cls)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors",
                selectedClass === cls
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              )}
            >
              {ASSET_CLASS_LABELS[cls]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ticker ou setor..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600"
            />
            Inativos
          </label>
        </div>
      </div>

      {/* Assets Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="px-5 py-3">Ativo</th>
                <th className="px-4 py-3 text-right">Qtd</th>
                <th className="px-4 py-3 text-right">Preço Médio</th>
                <th className="px-4 py-3 text-right">Cotação</th>
                <th className="px-4 py-3 text-right">Total (BRL)</th>
                <th className="px-4 py-3 text-right">Alvo / Real</th>
                <th className="px-5 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-sm text-slate-400 dark:text-slate-500"
                  >
                    Nenhum ativo encontrado.
                  </td>
                </tr>
              ) : (
                filteredAssets.map((a) => {
                  const isFixedOrReserve =
                    a.assetClass === "FIXED_INCOME" ||
                    a.assetClass === "EMERGENCY_RESERVE";
                  const profitPos = a.profitLossBRL >= 0;
                  return (
                    <tr
                      key={a.id}
                      className={cn(
                        "transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50",
                        !a.isActive && "opacity-60"
                      )}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {a.ticker}
                          </span>
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {ASSET_CLASS_LABELS[a.assetClass]}
                          </span>
                          {!a.isActive && (
                            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              Inativo
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {a.sector}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                        {maskQty(a.quantity, isPrivate, a.assetClass)}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono text-slate-600 tabular-nums dark:text-slate-400">
                        {a.quantity > 0
                          ? formatCurrency(a.avgPriceNative, a.currency)
                          : "—"}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatCurrency(a.currentPriceNative, a.currency)}
                        </div>
                        {a.currency === "USD" && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            {formatBRL(a.currentPriceBRL)}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900 dark:text-slate-100">
                          {maskBRL(a.currentValueBRL, isPrivate)}
                        </div>
                        {a.quantity > 0 && !isFixedOrReserve && (
                          <div
                            className={cn(
                              "text-[11px] font-semibold",
                              profitPos
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {profitPos ? "+" : ""}
                            {formatPct(a.profitLossPct, 1)}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right font-mono tabular-nums">
                        {a.assetClass === "EMERGENCY_RESERVE" ? (
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            Reserva
                          </span>
                        ) : (
                          <>
                            <div className="text-xs text-slate-600 dark:text-slate-400">
                              {formatPct(a.globalTargetPct)} /{" "}
                              <strong className="text-slate-900 dark:text-slate-100">
                                {formatPct(a.actualPct)}
                              </strong>
                            </div>
                            <div className="text-[11px] text-slate-400 dark:text-slate-500">
                              {formatPct(a.targetPctInClass)} na classe
                            </div>
                          </>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          {isFixedOrReserve && (
                            <button
                              type="button"
                              onClick={() => openBalanceModal(a)}
                              title="Atualizar saldo / rendimento"
                              className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                            >
                              Saldo
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(a)}
                            title="Editar ativo"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteAsset(a)}
                            title="Excluir ativo"
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

      {/* Sector Allocation Chart */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Alocação por Setor
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Concentração setorial dentro da classe
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {SECTOR_CLASSES.map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => setSelectedSectorClass(cls)}
                className={cn(
                  "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                  selectedSectorClass === cls
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                )}
              >
                {ASSET_CLASS_LABELS[cls]}
              </button>
            ))}
          </div>
        </div>

        {sectorData.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            Nenhum valor investido nesta classe ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sectorData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={82}
                    paddingAngle={2}
                    stroke={isDark ? "#0f172a" : "#ffffff"}
                  >
                    {sectorData.map((entry, idx) => (
                      <Cell
                        key={entry.name}
                        fill={SECTOR_PALETTE[idx % SECTOR_PALETTE.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => maskBRL(Number(value), isPrivate)}
                    contentStyle={tooltipContentStyle}
                    itemStyle={{ color: isDark ? "#e2e8f0" : "#0f172a" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {sectorData.map((s, idx) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor:
                          SECTOR_PALETTE[idx % SECTOR_PALETTE.length],
                      }}
                    />
                    <span className="truncate">{s.name}</span>
                  </span>
                  <span className="shrink-0 font-mono font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                    {formatPct(s.pct)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Create / Edit Asset Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs dark:bg-slate-950/70">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {form.id ? `Editar ${form.ticker}` : "Adicionar ativo"}
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

            <form onSubmit={handleSaveAsset} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Ticker
                  </label>
                  <input
                    required
                    type="text"
                    value={form.ticker}
                    onChange={(e) =>
                      setForm({ ...form, ticker: e.target.value.toUpperCase() })
                    }
                    placeholder="WEGE3, VOO..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm uppercase text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Classe
                  </label>
                  <select
                    value={form.assetClass}
                    onChange={(e) => {
                      const nextClass = e.target.value as AssetClassKey;
                      const isFixed =
                        nextClass === "FIXED_INCOME" ||
                        nextClass === "EMERGENCY_RESERVE";
                      setForm({
                        ...form,
                        assetClass: nextClass,
                        priceMode: isFixed ? "MANUAL" : "AUTO_YAHOO",
                        manualPrice: isFixed ? form.manualPrice || "1" : "",
                      });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    {ALL_ASSET_CLASSES.map((cls) => (
                      <option key={cls} value={cls}>
                        {ASSET_CLASS_LABELS[cls]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Setor
                </label>
                <input
                  required
                  type="text"
                  value={form.sector}
                  onChange={(e) => setForm({ ...form, sector: e.target.value })}
                  placeholder="Ex: Energia Elétrica, Logística, S&P 500..."
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    % Alvo na classe
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={form.targetPctInClass}
                    onChange={(e) =>
                      setForm({ ...form, targetPctInClass: e.target.value })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Cotação
                  </label>
                  <select
                    value={form.priceMode}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        priceMode: e.target.value as PriceModeKey,
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="AUTO_YAHOO">Automática (Yahoo)</option>
                    <option value="MANUAL">Manual / Fixa</option>
                  </select>
                </div>
              </div>

              {form.priceMode === "MANUAL" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Preço unitário manual
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0.0001"
                    value={form.manualPrice}
                    onChange={(e) =>
                      setForm({ ...form, manualPrice: e.target.value })
                    }
                    placeholder="1.00"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              )}

              {isFixedIncomeClass(form.assetClass) && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Rentabilidade Esperada (Renda Fixa)
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Indexador
                      </label>
                      <select
                        value={form.fixedIncomeIndex}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            fixedIncomeIndex: e.target.value as
                              | FixedIncomeIndexKey
                              | "",
                          })
                        }
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      >
                        <option value="">Não configurado</option>
                        {FIXED_INCOME_INDEXES.map((idx) => (
                          <option key={idx} value={idx}>
                            {FIXED_INCOME_INDEX_LABELS[idx]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Taxa padrão (%)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.fixedIncomeRate}
                        onChange={(e) =>
                          setForm({ ...form, fixedIncomeRate: e.target.value })
                        }
                        placeholder="Ex: 100 ou 6,5"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Vencimento (opcional)
                    </label>
                    <input
                      type="date"
                      value={form.maturityDate}
                      onChange={(e) =>
                        setForm({ ...form, maturityDate: e.target.value })
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={form.taxExempt}
                      onChange={(e) =>
                        setForm({ ...form, taxExempt: e.target.checked })
                      }
                      className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600"
                    />
                    Isento de Imposto de Renda (LCI, LCA, CRI, CRA)
                  </label>
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm({ ...form, isActive: e.target.checked })
                  }
                  className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 dark:border-slate-600"
                />
                Ativo na carteira (participa do plano de aporte)
              </label>

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
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Balance Update Modal (Fixed Income / Reserve) */}
      {balanceModalAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs dark:bg-slate-950/70">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Atualizar saldo — {balanceModalAsset.ticker}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setBalanceModalAsset(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Saldo atual registrado:{" "}
              <strong className="font-mono text-slate-800 dark:text-slate-200">
                {maskBRL(balanceModalAsset.currentValueBRL, isPrivate)}
              </strong>
              . Informe o valor atual na corretora para registrar o rendimento.
            </p>
            <form
              onSubmit={handleUpdateFixedIncomeBalance}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Novo saldo total (R$)
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  value={newBalanceValue}
                  onChange={(e) => setNewBalanceValue(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-base font-semibold text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBalanceModalAsset(null)}
                  className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingBalance}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  {savingBalance ? "Salvando..." : "Atualizar saldo"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
