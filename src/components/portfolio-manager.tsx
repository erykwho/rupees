"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
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
  type AssetSummary,
  FIXED_INCOME_INDEXES,
  FIXED_INCOME_INDEX_LABELS,
  type FixedIncomeIndexKey,
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
import { maskBRL, maskQty } from "@/lib/privacy";
import { cn } from "@/lib/utils";

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
  const { isPrivate } = usePrivacy();

  const [summary, setSummary] = useState<PortfolioSummary>(initialSummary);
  const [selectedClass, setSelectedClass] = useState<AssetClassKey | "ALL">(
    "ALL"
  );
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
  const [alertsExpanded, setAlertsExpanded] = useState(false);

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
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
          Carteira
        </h1>

        <button
          type="button"
          onClick={() => openCreateModal()}
          className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Ativo</span>
        </button>
      </div>

      {/* Consolidated Collapsible Alerts (only shown when real issues exist) */}
      {(classTargetIssues.length > 0 ||
        tickerValidationIssues.length > 0 ||
        sectorIssues.length > 0) && (
        <div className="overflow-hidden rounded-xl border border-amber-200/90 bg-amber-50/70 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200">
          <button
            type="button"
            onClick={() => setAlertsExpanded((prev) => !prev)}
            aria-expanded={alertsExpanded}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left font-semibold transition-colors hover:bg-amber-100/50 dark:hover:bg-amber-950/50"
          >
            <span className="flex min-w-0 items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="truncate">
                {[
                  classTargetIssues.length > 0
                    ? `${classTargetIssues.length} ${classTargetIssues.length === 1 ? "classe" : "classes"} ≠ 100%`
                    : null,
                  tickerValidationIssues.length > 0
                    ? `${tickerValidationIssues.length} ${tickerValidationIssues.length === 1 ? "ticker" : "tickers"}`
                    : null,
                  sectorIssues.length > 0
                    ? `${sectorIssues.length} ${sectorIssues.length === 1 ? "setor" : "setores"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-amber-600 transition-transform dark:text-amber-400",
                alertsExpanded && "rotate-180"
              )}
            />
          </button>

          {alertsExpanded && (
            <div className="space-y-3 border-t border-amber-200/70 px-3.5 py-3 dark:border-amber-900/50">
              {classTargetIssues.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700/90 dark:text-amber-300/90">
                    Soma das metas na classe ≠ 100%
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {classTargetIssues.map((c) => (
                      <span
                        key={c.assetClass}
                        className="rounded-lg bg-white/90 px-2 py-1 font-mono text-[11px] font-semibold text-amber-800 dark:bg-slate-900/80 dark:text-amber-300"
                      >
                        {c.label}: {formatPct(c.targetSumInClass, 1)}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {tickerValidationIssues.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                    Tickers não validados (toque para corrigir)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {tickerValidationIssues.map((a) => {
                      const isInvalid = a.tickerValidationStatus === "INVALID";
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => openEditModal(a)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-[11px] font-semibold transition-colors",
                            isInvalid
                              ? "bg-white/90 text-rose-700 hover:bg-white dark:bg-slate-900/80 dark:text-rose-300"
                              : "bg-amber-100/90 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/70 dark:text-amber-300"
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
              )}

              {sectorIssues.length > 0 && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700/90 dark:text-amber-300/90">
                      Divergência por setor
                    </p>
                    <Link
                      href="/objetivos"
                      className="text-[11px] font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
                    >
                      Objetivos →
                    </Link>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sectorIssues.map((s) => (
                      <span
                        key={`${s.assetClass}::${s.sector}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-800 dark:bg-slate-900/90 dark:text-slate-200"
                      >
                        <span className="font-semibold">
                          {ASSET_CLASS_LABELS[s.assetClass]} · {s.sector}
                        </span>
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {formatPct(s.targetPctInClass, 0)}/
                          {formatPct(s.goalTargetPct ?? 0, 0)}
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
                            className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-700"
                          >
                            + Ativo
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Mobile Single-Row Filter Bar */}
      <div className="flex items-center gap-1.5 md:hidden">
        <div className="relative shrink-0">
          <select
            aria-label="Filtrar por classe"
            value={selectedClass}
            onChange={(e) =>
              setSelectedClass(e.target.value as AssetClassKey | "ALL")
            }
            className="h-9 appearance-none rounded-xl border border-slate-200 bg-white pl-2.5 pr-7 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="ALL">Todas</option>
            {ALL_ASSET_CLASSES.map((cls) => (
              <option key={cls} value={cls}>
                {ASSET_CLASS_LABELS[cls]}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar..."
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowInactive((prev) => !prev)}
          aria-pressed={showInactive}
          className={cn(
            "h-9 shrink-0 rounded-xl border px-2.5 text-xs font-semibold transition-colors",
            showInactive
              ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
              : "border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          )}
        >
          Inativos
        </button>
      </div>

      {/* Desktop Filter Bar */}
      <div className="hidden items-center justify-between gap-3 md:flex">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedClass("ALL")}
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
              onClick={() => setSelectedClass(cls)}
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
          <div className="relative w-52">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ticker ou setor..."
              className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowInactive((prev) => !prev)}
            aria-pressed={showInactive}
            className={cn(
              "whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
              showInactive
                ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            )}
          >
            Inativos
          </button>
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
                                "flex items-center justify-end gap-1.5",
                                !isFixedOrReserve &&
                                  "border-t border-slate-200/70 pt-2.5 dark:border-slate-700/70"
                              )}
                            >
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
                    Isento de IR (LCI, LCA, CRI, CRA)
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
                Ativo na carteira
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
          <div className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Saldo — {balanceModalAsset.ticker}
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
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Atual:{" "}
              <strong className="font-mono text-slate-800 dark:text-slate-200">
                {maskBRL(balanceModalAsset.currentValueBRL, isPrivate)}
              </strong>
            </p>
            <form
              onSubmit={handleUpdateFixedIncomeBalance}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Novo saldo (R$)
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
                  {savingBalance ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
