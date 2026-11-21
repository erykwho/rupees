"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Layers,
  Loader2,
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
  isVariableIncomeClass,
} from "@/lib/domain/types";
import {
  getExpectedExchangeLabel,
  normalizeTicker,
} from "@/lib/domain/ticker-validation";
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

interface TickerSearchResult {
  ticker: string;
  yahooSymbol: string;
  name: string;
  exchange: string;
  quoteType: string;
  currency: string;
  price?: number | null;
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
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);

  function handleSelectClass(cls: AssetClassKey | "ALL") {
    setSelectedClass(cls);
    if (cls !== "ALL" && SECTOR_CLASSES.includes(cls as InvestmentClassKey)) {
      setSelectedSectorClass(cls as InvestmentClassKey);
    }
  }

  const sectorRows = useMemo(
    () =>
      summary.sectors
        .filter(
          (s) =>
            s.assetClass === selectedSectorClass &&
            (s.currentValueBRL > 0 ||
              (s.goalTargetPct ?? 0) > 0 ||
              s.targetPctInClass > 0)
        )
        .map((s) => ({
          name: s.sector,
          value: Number(s.currentValueBRL.toFixed(2)),
          pct: Number(s.actualPctInClass.toFixed(1)),
          goalPct: s.goalTargetPct,
          status: s.status,
        })),
    [summary.sectors, selectedSectorClass]
  );

  const sectorPieData = useMemo(
    () => sectorRows.filter((s) => s.value > 0),
    [sectorRows]
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
  const [yahooUnavailableError, setYahooUnavailableError] = useState<
    string | null
  >(null);

  // Yahoo ticker autocomplete state (for variable-income classes)
  const [tickerSuggestions, setTickerSuggestions] = useState<
    TickerSearchResult[]
  >([]);
  const [searchingTickers, setSearchingTickers] = useState(false);
  const [searchUnavailable, setSearchUnavailable] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedTickerInfo, setSelectedTickerInfo] =
    useState<TickerSearchResult | null>(null);
  const [tickerTouched, setTickerTouched] = useState(false);
  const tickerBoxRef = useRef<HTMLDivElement | null>(null);

  // Inline new sector creation inside asset modal
  const [creatingNewSector, setCreatingNewSector] = useState(false);
  const [inlineSectorName, setInlineSectorName] = useState("");
  const [inlineSectorTarget, setInlineSectorTarget] = useState("");
  const [savingInlineSector, setSavingInlineSector] = useState(false);

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

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        tickerBoxRef.current &&
        !tickerBoxRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Debounced Yahoo ticker search for variable-income classes
  useEffect(() => {
    if (!modalOpen || !isVariableIncomeClass(form.assetClass)) {
      return;
    }

    const q = form.ticker.trim();
    if (!q || !tickerTouched) {
      return;
    }

    // If user just selected an item matching the input, skip re-fetching
    if (
      selectedTickerInfo &&
      selectedTickerInfo.ticker === normalizeTicker(q, form.assetClass)
    ) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchingTickers(true);
      setSearchUnavailable(false);
      try {
        const params = new URLSearchParams({
          q,
          assetClass: form.assetClass,
        });
        const res = await fetch(`/api/tickers/search?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          setTickerSuggestions([]);
          setSearchUnavailable(true);
          return;
        }
        const data = (await res.json()) as {
          results?: TickerSearchResult[];
          unavailable?: boolean;
        };
        setTickerSuggestions(data.results ?? []);
        setSearchUnavailable(Boolean(data.unavailable));
        setDropdownOpen(true);
      } catch (err) {
        if ((err as { name?: string })?.name !== "AbortError") {
          setTickerSuggestions([]);
          setSearchUnavailable(true);
        }
      } finally {
        setSearchingTickers(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [modalOpen, form.ticker, form.assetClass, tickerTouched, selectedTickerInfo]);

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

  const tickerValidationIssues = useMemo(() => {
    return summary.assets.filter(
      (a) =>
        isVariableIncomeClass(a.assetClass) &&
        a.tickerValidationStatus !== "VERIFIED"
    );
  }, [summary.assets]);

  const sectorIssues = useMemo(() => {
    return summary.sectors
      .filter((s) => {
        if (!isVariableIncomeClass(s.assetClass)) return false;
        if (selectedClass !== "ALL" && s.assetClass !== selectedClass)
          return false;
        return (
          s.status === "UNCOVERED" ||
          s.status === "UNDER" ||
          s.status === "OVER"
        );
      })
      .sort((a, b) => {
        const order = { UNCOVERED: 0, UNDER: 1, OVER: 2, EXACT: 3, UNTRACKED: 4 };
        if (order[a.status] !== order[b.status]) {
          return order[a.status] - order[b.status];
        }
        return (b.goalTargetPct ?? 0) - (a.goalTargetPct ?? 0);
      });
  }, [summary.sectors, selectedClass]);

  const availableSectorsForFormClass = useMemo(() => {
    if (!isVariableIncomeClass(form.assetClass)) return [];
    const names = new Set<string>();
    for (const s of summary.sectors) {
      if (s.assetClass === form.assetClass) {
        names.add(s.sector);
      }
    }
    if (form.sector.trim()) {
      names.add(form.sector.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [summary.sectors, form.assetClass, form.sector]);

  function openCreateModal(preset?: {
    assetClass?: AssetClassKey;
    sector?: string;
    targetPctInClass?: string;
  }) {
    setError(null);
    setYahooUnavailableError(null);
    setSelectedTickerInfo(null);
    setTickerSuggestions([]);
    setDropdownOpen(false);
    setTickerTouched(false);
    setCreatingNewSector(false);
    setInlineSectorName("");
    setInlineSectorTarget("");
    const targetClass =
      preset?.assetClass ??
      (selectedClass === "ALL" ? "BR_STOCK" : selectedClass);
    const isFixed = isFixedIncomeClass(targetClass);
    const defaultSector =
      preset?.sector ??
      (isVariableIncomeClass(targetClass)
        ? summary.sectors.find((s) => s.assetClass === targetClass)?.sector ?? ""
        : "");
    setForm({
      ...EMPTY_FORM,
      assetClass: targetClass,
      sector: defaultSector,
      targetPctInClass: preset?.targetPctInClass ?? "0",
      priceMode: isFixed ? "MANUAL" : "AUTO_YAHOO",
      manualPrice: isFixed ? "1" : "",
    });
    setModalOpen(true);
  }

  function openEditModal(asset: AssetSummary) {
    setError(null);
    setYahooUnavailableError(null);
    setSelectedTickerInfo(null);
    setTickerSuggestions([]);
    setDropdownOpen(false);
    setTickerTouched(false);
    setCreatingNewSector(false);
    setInlineSectorName("");
    setInlineSectorTarget("");
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

  async function handleCreateInlineSector() {
    if (!isVariableIncomeClass(form.assetClass)) return;
    const trimmed = inlineSectorName.trim();
    if (!trimmed) {
      setError("Informe o nome do novo setor.");
      return;
    }

    setSavingInlineSector(true);
    setError(null);

    try {
      const targetVal = Number(inlineSectorTarget.replace(",", ".")) || 0;
      const res = await fetch("/api/sector-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetClass: form.assetClass,
          name: trimmed,
          targetPct: targetVal,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Erro ao criar setor.");
        return;
      }

      setForm((prev) => ({ ...prev, sector: trimmed }));
      setCreatingNewSector(false);
      setInlineSectorName("");
      setInlineSectorTarget("");
      await reloadPortfolio();
    } finally {
      setSavingInlineSector(false);
    }
  }

  async function submitAsset(allowUnverifiedOnUnavailable = false) {
    setSaving(true);
    setError(null);
    setYahooUnavailableError(null);

    try {
      const isFixed = isFixedIncomeClass(form.assetClass);
      const parsedFiRate = form.fixedIncomeRate.trim()
        ? Number(form.fixedIncomeRate.replace(",", "."))
        : null;

      const payload = {
        ticker: normalizeTicker(form.ticker, form.assetClass),
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
        allowUnverifiedOnUnavailable,
      };

      const url = form.id ? `/api/assets/${form.id}` : "/api/assets";
      const method = form.id ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        if (data.code === "YAHOO_UNAVAILABLE") {
          setYahooUnavailableError(
            data.error ??
              "Não foi possível consultar o Yahoo Finance no momento."
          );
          return;
        }
        setError(data.error ?? "Erro ao salvar ativo.");
        return;
      }

      setModalOpen(false);
      await reloadPortfolio();
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAsset(e: React.FormEvent) {
    e.preventDefault();
    await submitAsset(false);
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
          onClick={() => openCreateModal()}
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

      {/* Ticker Validation Inconsistency Banner */}
      {tickerValidationIssues.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                Inconsistência de ticker detectada no Yahoo Finance
              </p>
              <p className="mt-0.5 text-[11px] text-rose-700/90 dark:text-rose-300/90">
                Os ativos abaixo não foram confirmados na bolsa da sua classe ou
                aguardam revalidação automática. Clique em um ticker para
                corrigir.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {tickerValidationIssues.map((a) => {
                  const isInvalid = a.tickerValidationStatus === "INVALID";
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => openEditModal(a)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition-colors",
                        isInvalid
                          ? "bg-white/90 text-rose-800 hover:bg-white dark:bg-slate-900/80 dark:text-rose-300 dark:hover:bg-slate-900"
                          : "bg-amber-100/90 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300 dark:hover:bg-amber-950"
                      )}
                    >
                      <span>{a.ticker}</span>
                      <span className="font-sans text-[10px] font-medium opacity-80">
                        · {isInvalid ? "Inválido" : "Pendente"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sector Coverage Alerts Banner */}
      {sectorIssues.length > 0 && (
        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/70 p-4 text-xs text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          <div className="flex items-start justify-between gap-2.5">
            <div className="flex items-start gap-2.5">
              <Layers className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <div>
                <p className="font-semibold">
                  Cobertura por setor: {sectorIssues.length} setor
                  {sectorIssues.length === 1 ? "" : "es"} com divergência na
                  alocação alvo
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sectorIssues.map((s) => (
                    <span
                      key={`${s.assetClass}::${s.sector}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-800 shadow-2xs dark:bg-slate-900/90 dark:text-slate-200"
                    >
                      <span className="font-semibold">
                        {ASSET_CLASS_LABELS[s.assetClass]} · {s.sector}
                      </span>
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {formatPct(s.targetPctInClass, 1)} /{" "}
                        {formatPct(s.goalTargetPct ?? 0, 1)}
                      </span>
                      {s.status === "UNCOVERED" && (
                        <button
                          type="button"
                          onClick={() =>
                            openCreateModal({
                              assetClass: s.assetClass,
                              sector: s.sector,
                              targetPctInClass: String(s.goalTargetPct ?? 0),
                            })
                          }
                          className="ml-0.5 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
                        >
                          + Ativo
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Link
              href="/objetivos"
              className="shrink-0 font-semibold text-rose-700 hover:underline dark:text-rose-300"
            >
              Objetivos →
            </Link>
          </div>
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
      <div className="-mx-4 overflow-hidden border-y border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900 sm:-mx-6 md:mx-0 md:rounded-2xl md:border">
        {/* Mobile Compact 3-Column Accordion Table */}
        <div className="md:hidden">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <th className="py-3 pl-3 pr-1.5">Ativo</th>
                <th className="px-1.5 py-3 text-right">Total</th>
                <th className="py-3 pl-1.5 pr-3 text-right">Alvo / Real</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td
                    colSpan={3}
                    className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500"
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
                  const isExpanded = expandedAssetId === a.id;
                  const toggleExpanded = () =>
                    setExpandedAssetId((prev) => (prev === a.id ? null : a.id));
                  const subtitle =
                    selectedClass === "ALL"
                      ? a.sector
                        ? `${ASSET_CLASS_LABELS[a.assetClass]} · ${a.sector}`
                        : ASSET_CLASS_LABELS[a.assetClass]
                      : a.sector || ASSET_CLASS_LABELS[a.assetClass];

                  return (
                    <Fragment key={a.id}>
                      <tr
                        onClick={toggleExpanded}
                        className={cn(
                          "cursor-pointer transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50",
                          isExpanded && "bg-slate-50/60 dark:bg-slate-800/40",
                          !a.isActive && "opacity-60"
                        )}
                      >
                        <td className="py-3 pl-3 pr-1.5 align-top">
                          <div className="flex flex-wrap items-center gap-1">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Recolher" : "Expandir"} detalhes de ${a.ticker}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpanded();
                              }}
                              className="inline-flex items-center gap-1 text-left font-mono font-bold text-slate-900 focus:outline-none dark:text-slate-100"
                            >
                              <span>{a.ticker}</span>
                              <ChevronDown
                                className={cn(
                                  "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500",
                                  isExpanded && "rotate-180 text-emerald-600 dark:text-emerald-400"
                                )}
                              />
                            </button>
                            {!isFixedOrReserve &&
                              a.tickerValidationStatus === "INVALID" && (
                                <span
                                  title="Ticker não encontrado na bolsa desta classe no Yahoo Finance"
                                  className="inline-flex items-center rounded-md bg-rose-100 px-1 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                                >
                                  <AlertTriangle className="h-3 w-3" />
                                </span>
                              )}
                            {!isFixedOrReserve &&
                              a.tickerValidationStatus === "PENDING" && (
                                <span
                                  title="Aguardando revalidação automática no Yahoo Finance"
                                  className="inline-flex items-center rounded-md bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                >
                                  <Clock className="h-3 w-3" />
                                </span>
                              )}
                            {!a.isActive && (
                              <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                Inativo
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 max-w-[135px] truncate text-xs text-slate-500 dark:text-slate-400">
                            {subtitle}
                          </p>
                        </td>

                        <td className="whitespace-nowrap px-1.5 py-3 text-right align-top font-mono tabular-nums">
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

                        <td className="whitespace-nowrap py-3 pl-1.5 pr-3 text-right align-top font-mono tabular-nums">
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
                                {formatPct(a.targetPctInClass)} classe
                              </div>
                            </>
                          )}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/90 dark:bg-slate-800/40">
                          <td colSpan={3} className="px-3 py-3">
                            {!isFixedOrReserve && (
                              <div className="mb-3 grid grid-cols-3 gap-2 font-mono tabular-nums">
                                <div>
                                  <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                                    Qtd
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {maskQty(a.quantity, isPrivate, a.assetClass)}
                                  </p>
                                </div>
                                <div>
                                  <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                                    Preço Médio
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {a.quantity > 0
                                      ? formatCurrency(a.avgPriceNative, a.currency)
                                      : "—"}
                                  </p>
                                </div>
                                <div>
                                  <p className="font-sans text-xs text-slate-500 dark:text-slate-400">
                                    Cotação
                                  </p>
                                  <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
                                    {formatCurrency(
                                      a.currentPriceNative,
                                      a.currency
                                    )}
                                  </p>
                                  {a.currency === "USD" && (
                                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                      {formatBRL(a.currentPriceBRL)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            <div
                              className={cn(
                                "flex flex-wrap items-center justify-between gap-2",
                                !isFixedOrReserve &&
                                  "border-t border-slate-200/70 pt-2.5 dark:border-slate-700/70"
                              )}
                            >
                              <div className="min-w-0 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {ASSET_CLASS_LABELS[a.assetClass]}
                                </span>
                                {a.sector && <span> · {a.sector}</span>}
                                {a.assetClass === "EMERGENCY_RESERVE" ? (
                                  <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                                    Reserva de emergência
                                  </span>
                                ) : (
                                  <span className="block font-mono text-[11px] text-slate-400 dark:text-slate-500">
                                    {formatPct(a.targetPctInClass)} na classe
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5">
                                {isFixedOrReserve && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openBalanceModal(a);
                                    }}
                                    className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                                  >
                                    Saldo
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditModal(a);
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
                                    handleDeleteAsset(a);
                                  }}
                                  aria-label={`Excluir ${a.ticker}`}
                                  title="Excluir ativo"
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
                <th className="py-3 pl-4 pr-2 xl:pl-5 xl:pr-3">Ativo</th>
                <th className="px-2 py-3 text-right xl:px-3">Qtd</th>
                <th className="px-2 py-3 text-right xl:px-3">Cotação / PM</th>
                <th className="px-2 py-3 text-right xl:px-3">Total (BRL)</th>
                <th className="px-2 py-3 text-right xl:px-3">Alvo / Real</th>
                <th className="py-3 pl-2 pr-4 text-right xl:pl-3 xl:pr-5">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
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
                      <td className="py-3.5 pl-4 pr-2 xl:pl-5 xl:pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                            {a.ticker}
                          </span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {ASSET_CLASS_LABELS[a.assetClass]}
                          </span>
                          {!isFixedOrReserve &&
                            a.tickerValidationStatus === "INVALID" && (
                              <span
                                title="Ticker não encontrado na bolsa desta classe no Yahoo Finance"
                                className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Ticker inválido
                              </span>
                            )}
                          {!isFixedOrReserve &&
                            a.tickerValidationStatus === "PENDING" && (
                              <span
                                title="Aguardando revalidação automática no Yahoo Finance"
                                className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                              >
                                <Clock className="h-3 w-3" />
                                Pendente
                              </span>
                            )}
                          {!a.isActive && (
                            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              Inativo
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 max-w-[170px] truncate text-xs text-slate-500 dark:text-slate-400 xl:max-w-[260px]">
                          {a.sector}
                        </p>
                      </td>

                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300 xl:px-3">
                        {maskQty(a.quantity, isPrivate, a.assetClass)}
                      </td>

                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono tabular-nums xl:px-3">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatCurrency(a.currentPriceNative, a.currency)}
                        </div>
                        {!isFixedOrReserve && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            PM{" "}
                            {a.quantity > 0
                              ? formatCurrency(a.avgPriceNative, a.currency)
                              : "—"}
                          </div>
                        )}
                        {a.currency === "USD" && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            {formatBRL(a.currentPriceBRL)}
                          </div>
                        )}
                      </td>

                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono tabular-nums xl:px-3">
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

                      <td className="whitespace-nowrap px-2 py-3.5 text-right font-mono tabular-nums xl:px-3">
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

                      <td className="whitespace-nowrap py-3.5 pl-2 pr-4 text-right xl:pl-3 xl:pr-5">
                        <div className="inline-flex items-center gap-0.5 xl:gap-1">
                          {isFixedOrReserve && (
                            <button
                              type="button"
                              onClick={() => openBalanceModal(a)}
                              title="Atualizar saldo / rendimento"
                              className="rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
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

        {sectorRows.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
            Nenhum valor investido ou meta de setor nesta classe ainda.
          </div>
        ) : (
          <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2">
            <div className="h-56 w-full">
              {sectorPieData.length === 0 ? (
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  Nenhum valor investido nesta classe ainda.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={sectorPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={82}
                      paddingAngle={2}
                      stroke={isDark ? "#0f172a" : "#ffffff"}
                    >
                      {sectorPieData.map((entry, idx) => (
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
              )}
            </div>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {sectorRows.map((s) => {
                const pieIdx = sectorPieData.findIndex(
                  (p) => p.name === s.name
                );
                return (
                  <div
                    key={s.name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-300">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full",
                          pieIdx < 0 &&
                            "border border-dashed border-slate-400 bg-transparent dark:border-slate-500"
                        )}
                        style={
                          pieIdx >= 0
                            ? {
                                backgroundColor:
                                  SECTOR_PALETTE[
                                    pieIdx % SECTOR_PALETTE.length
                                  ],
                              }
                            : undefined
                        }
                      />
                      <span className="truncate">{s.name}</span>
                      {s.status === "UNCOVERED" && (
                        <span className="shrink-0 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          Sem ativos
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right font-mono tabular-nums">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">
                        {formatPct(s.pct)}
                      </span>
                      {s.goalPct !== null && (
                        <span className="ml-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          / alvo {formatPct(s.goalPct, 0)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
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

            {yahooUnavailableError && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-2">
                    <p className="font-medium">{yahooUnavailableError}</p>
                    <p className="text-[11px] opacity-85">
                      Você pode tentar novamente mais tarde ou salvar agora como{" "}
                      <strong>Pendente</strong> — o ativo exibirá um alerta até
                      ser validado automaticamente quando o Yahoo voltar.
                    </p>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => submitAsset(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                    >
                      {saving ? "Salvando..." : "Salvar mesmo assim (pendente)"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveAsset} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div ref={tickerBoxRef} className="relative">
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Ticker
                  </label>
                  <div className="relative">
                    <input
                      required
                      type="text"
                      autoComplete="off"
                      value={form.ticker}
                      onFocus={() => {
                        if (
                          isVariableIncomeClass(form.assetClass) &&
                          tickerSuggestions.length > 0
                        ) {
                          setDropdownOpen(true);
                        }
                      }}
                      onChange={(e) => {
                        const nextVal = e.target.value.toUpperCase();
                        setTickerTouched(true);
                        setSelectedTickerInfo(null);
                        setYahooUnavailableError(null);
                        setError(null);
                        if (!nextVal.trim()) {
                          setTickerSuggestions([]);
                          setSearchUnavailable(false);
                          setDropdownOpen(false);
                        }
                        setForm({
                          ...form,
                          ticker: nextVal,
                        });
                      }}
                      placeholder={
                        isFixedIncomeClass(form.assetClass)
                          ? "Ex: CDB Inter, Selic..."
                          : form.assetClass === "BR_STOCK" ||
                              form.assetClass === "BR_FII"
                            ? "Ex: WEGE3, HGLG11..."
                            : "Ex: VOO, AAPL, O..."
                      }
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 font-mono text-sm uppercase text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    {searchingTickers && (
                      <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                    )}
                    {!searchingTickers &&
                      selectedTickerInfo &&
                      isVariableIncomeClass(form.assetClass) && (
                        <CheckCircle2 className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" />
                      )}
                  </div>

                  {/* Yahoo Finance Autocomplete Dropdown */}
                  {isVariableIncomeClass(form.assetClass) &&
                    dropdownOpen &&
                    tickerTouched &&
                    form.ticker.trim().length > 0 && (
                      <div className="absolute left-0 z-30 mt-1.5 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        {searchingTickers ? (
                          <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Buscando em{" "}
                            {getExpectedExchangeLabel(form.assetClass)}...
                          </div>
                        ) : tickerSuggestions.length > 0 ? (
                          <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                            {tickerSuggestions.map((item) => (
                              <li key={item.yahooSymbol}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setForm((prev) => ({
                                      ...prev,
                                      ticker: item.ticker,
                                    }));
                                    setSelectedTickerInfo(item);
                                    setDropdownOpen(false);
                                    setError(null);
                                    setYahooUnavailableError(null);
                                  }}
                                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-xs font-bold text-slate-900 dark:text-slate-100">
                                        {item.ticker}
                                      </span>
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {item.exchange}
                                      </span>
                                    </div>
                                    <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                                      {item.name}
                                    </p>
                                  </div>
                                  {typeof item.price === "number" &&
                                    item.price > 0 && (
                                      <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                                        {formatCurrency(
                                          item.price,
                                          item.currency === "USD"
                                            ? "USD"
                                            : "BRL"
                                        )}
                                      </span>
                                    )}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : searchUnavailable ? (
                          <div className="px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
                            Busca no Yahoo indisponível no momento. Você ainda
                            pode tentar salvar o ticker.
                          </div>
                        ) : (
                          <div className="px-3 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                            Nenhum ticker encontrado em{" "}
                            {getExpectedExchangeLabel(form.assetClass)}.
                          </div>
                        )}
                      </div>
                    )}
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
                      setSelectedTickerInfo(null);
                      setTickerSuggestions([]);
                      setDropdownOpen(false);
                      setError(null);
                      setYahooUnavailableError(null);
                      if (!isFixed && form.ticker.trim()) {
                        setTickerTouched(true);
                      }
                      const nextDefaultSector = isVariableIncomeClass(nextClass)
                        ? summary.sectors.find((s) => s.assetClass === nextClass)
                            ?.sector ?? ""
                        : form.sector;
                      setCreatingNewSector(false);
                      setForm({
                        ...form,
                        assetClass: nextClass,
                        sector: nextDefaultSector,
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

              {isVariableIncomeClass(form.assetClass) && (
                <div className="-mt-2 text-[11px]">
                  {selectedTickerInfo ? (
                    <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {selectedTickerInfo.name} · {selectedTickerInfo.exchange}
                      </span>
                    </p>
                  ) : (
                    <p className="text-slate-400 dark:text-slate-500">
                      Validado automaticamente no Yahoo Finance (
                      {getExpectedExchangeLabel(form.assetClass)}).
                    </p>
                  )}
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Setor
                  </label>
                  {isVariableIncomeClass(form.assetClass) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingNewSector((prev) => !prev);
                        setError(null);
                      }}
                      className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                    >
                      {creatingNewSector ? "Selecionar existente" : "+ Novo setor"}
                    </button>
                  )}
                </div>

                {isVariableIncomeClass(form.assetClass) ? (
                  creatingNewSector || availableSectorsForFormClass.length === 0 ? (
                    <div className="space-y-2 rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={inlineSectorName}
                          onChange={(e) => setInlineSectorName(e.target.value)}
                          placeholder="Nome do novo setor (ex: Transporte)"
                          className="flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={inlineSectorTarget}
                          onChange={(e) => setInlineSectorTarget(e.target.value)}
                          placeholder="Meta %"
                          className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Cadastra o setor em {ASSET_CLASS_LABELS[form.assetClass]}
                        </span>
                        <button
                          type="button"
                          onClick={handleCreateInlineSector}
                          disabled={savingInlineSector}
                          className="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {savingInlineSector ? "Criando..." : "Criar setor"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <select
                      required
                      value={form.sector}
                      onChange={(e) => setForm({ ...form, sector: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="" disabled>
                        Selecione um setor...
                      </option>
                      {availableSectorsForFormClass.map((sectorName) => (
                        <option key={sectorName} value={sectorName}>
                          {sectorName}
                        </option>
                      ))}
                    </select>
                  )
                ) : (
                  <input
                    required
                    type="text"
                    value={form.sector}
                    onChange={(e) => setForm({ ...form, sector: e.target.value })}
                    placeholder="Ex: Tesouro IPCA, CDB, Reserva..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                )}
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
