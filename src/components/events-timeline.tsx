"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  History,
  Layers,
  Loader2,
  PieChart,
  RotateCcw,
  Search,
  Target,
  X,
} from "lucide-react";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  type AuditActionKey,
  type AuditEntityTypeKey,
  type AuditEventDTO,
  buildEventSummary,
  buildRevertDescription,
  computeAuditDiffs,
} from "@/lib/domain/audit";
import { usePrivacy } from "@/components/privacy-provider";
import { cn } from "@/lib/utils";

interface EventsTimelineProps {
  initialEvents: AuditEventDTO[];
  initialNextCursor: string | null;
  initialTotalCount: number;
}

const ENTITY_FILTER_OPTIONS: Array<{
  value: AuditEntityTypeKey | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Todos módulos" },
  { value: "ASSET", label: "Carteira" },
  { value: "TRANSACTION", label: "Lançamentos" },
  { value: "GOAL", label: "Objetivos" },
  { value: "SECTOR_GOAL", label: "Setores" },
];

const ACTION_FILTER_OPTIONS: Array<{
  value: AuditActionKey | "ALL";
  label: string;
}> = [
  { value: "ALL", label: "Todas ações" },
  { value: "CREATE", label: "Criação" },
  { value: "UPDATE", label: "Edição" },
  { value: "DELETE", label: "Exclusão" },
  { value: "REVERT", label: "Reversão" },
];

function getEntityIcon(entityType: AuditEntityTypeKey) {
  if (entityType === "ASSET") return PieChart;
  if (entityType === "TRANSACTION") return ArrowLeftRight;
  if (entityType === "SECTOR_GOAL") return Layers;
  return Target;
}

function getActionBadgeClass(action: AuditActionKey): string {
  switch (action) {
    case "CREATE":
      return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";
    case "UPDATE":
      return "bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300";
    case "DELETE":
      return "bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300";
    case "REVERT":
      return "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300";
  }
}

function getEntityIconBoxClass(entityType: AuditEntityTypeKey): string {
  switch (entityType) {
    case "ASSET":
      return "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400";
    case "TRANSACTION":
      return "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-400";
    case "GOAL":
      return "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400";
    case "SECTOR_GOAL":
      return "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400";
  }
}

function formatDayGroupLabel(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const todayKey = now.toLocaleDateString("en-CA");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = yesterday.toLocaleDateString("en-CA");
  const dateKey = date.toLocaleDateString("en-CA");

  if (dateKey === todayKey) return "Hoje";
  if (dateKey === yesterdayKey) return "Ontem";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatTime(isoDate: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

export function EventsTimeline({
  initialEvents,
  initialNextCursor,
  initialTotalCount,
}: EventsTimelineProps) {
  const { isPrivate } = usePrivacy();

  const [events, setEvents] = useState<AuditEventDTO[]>(initialEvents);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [totalCount, setTotalCount] = useState<number>(initialTotalCount);

  const [entityFilter, setEntityFilter] = useState<AuditEntityTypeKey | "ALL">(
    "ALL"
  );
  const [actionFilter, setActionFilter] = useState<AuditActionKey | "ALL">(
    "ALL"
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const [confirmEvent, setConfirmEvent] = useState<AuditEventDTO | null>(null);
  const [reverting, setReverting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const fetchEvents = useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      const append = options?.append ?? false;
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      try {
        const params = new URLSearchParams();
        if (entityFilter !== "ALL") params.set("entityType", entityFilter);
        if (actionFilter !== "ALL") params.set("action", actionFilter);
        if (debouncedQuery) params.set("q", debouncedQuery);
        if (options?.cursor) params.set("cursor", options.cursor);
        params.set("limit", "30");

        const res = await fetch(`/api/events?${params.toString()}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error ?? "Erro ao carregar eventos");
        }

        setEvents((prev) =>
          append ? [...prev, ...(data.events as AuditEventDTO[])] : data.events
        );
        setNextCursor(data.nextCursor ?? null);
        setTotalCount(data.totalCount ?? 0);
      } catch (err) {
        setFeedback({
          type: "error",
          message:
            err instanceof Error ? err.message : "Erro ao carregar eventos.",
        });
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [entityFilter, actionFilter, debouncedQuery]
  );

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    void fetchEvents({ append: false });
  }, [fetchEvents]);

  async function handleConfirmRevert() {
    if (!confirmEvent) return;
    setReverting(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/events/${confirmEvent.id}/revert`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Não foi possível reverter este evento.");
      }

      const label = confirmEvent.entityLabel;
      setConfirmEvent(null);
      setFeedback({
        type: "success",
        message: `"${label}" revertido com sucesso.`,
      });
      await fetchEvents({ append: false });
    } catch (err) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Erro inesperado ao reverter evento.",
      });
      setConfirmEvent(null);
    } finally {
      setReverting(false);
    }
  }

  function toggleExpanded(eventId: string) {
    setExpandedIds((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  }

  const groupedEvents = useMemo(() => {
    const groups: Array<{
      dayKey: string;
      label: string;
      items: AuditEventDTO[];
    }> = [];
    const map = new Map<
      string,
      { dayKey: string; label: string; items: AuditEventDTO[] }
    >();

    for (const ev of events) {
      const dayKey = new Date(ev.createdAt).toLocaleDateString("en-CA");
      let group = map.get(dayKey);
      if (!group) {
        group = {
          dayKey,
          label: formatDayGroupLabel(ev.createdAt),
          items: [],
        };
        map.set(dayKey, group);
        groups.push(group);
      }
      group.items.push(ev);
    }

    return groups;
  }, [events]);

  const confirmDiffs = useMemo(() => {
    if (!confirmEvent) return [];
    // Inverted preview: current state (afterState) reverts to beforeState
    return computeAuditDiffs(
      confirmEvent.entityType,
      confirmEvent.afterState,
      confirmEvent.beforeState,
      { isPrivate }
    );
  }, [confirmEvent, isPrivate]);

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Compact Header */}
      <div className="flex items-baseline gap-2">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-slate-100">
          Eventos
        </h1>
        <span className="font-mono text-xs font-medium text-slate-400 tabular-nums dark:text-slate-500">
          {totalCount}
        </span>
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
          <div className="flex items-center gap-2">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
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

      {/* Compact Filter Bar: Search + 2 Native Selects */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar ticker ou evento..."
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-8 pr-8 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
          <div className="relative">
            <select
              aria-label="Filtrar por módulo"
              value={entityFilter}
              onChange={(e) =>
                setEntityFilter(e.target.value as AuditEntityTypeKey | "ALL")
              }
              className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-7 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {ENTITY_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            />
          </div>

          <div className="relative">
            <select
              aria-label="Filtrar por ação"
              value={actionFilter}
              onChange={(e) =>
                setActionFilter(e.target.value as AuditActionKey | "ALL")
              }
              className="h-9 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-3 pr-7 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {ACTION_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* Compact Log Timeline */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white py-12 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
          Carregando...
        </div>
      ) : groupedEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <History className="h-6 w-6 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Nenhum evento encontrado
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedEvents.map((group) => (
            <section key={group.dayKey} className="space-y-2">
              <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </h2>

              <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
                {group.items.map((ev) => {
                  const Icon = getEntityIcon(ev.entityType);
                  const diffs = computeAuditDiffs(
                    ev.entityType,
                    ev.beforeState,
                    ev.afterState,
                    { isPrivate }
                  );
                  const summary = buildEventSummary(
                    ev.entityType,
                    ev.action,
                    ev.entityLabel,
                    ev.beforeState,
                    ev.afterState,
                    isPrivate
                  );
                  const hasDetails =
                    diffs.length > 0 ||
                    (!ev.canRevert && Boolean(ev.cannotRevertReason));
                  const isExpanded = Boolean(expandedIds[ev.id]);

                  return (
                    <div
                      key={ev.id}
                      className={cn(
                        "transition-colors",
                        ev.isReverted && "opacity-75"
                      )}
                    >
                      <div
                        role={hasDetails ? "button" : undefined}
                        tabIndex={hasDetails ? 0 : undefined}
                        aria-expanded={hasDetails ? isExpanded : undefined}
                        onClick={
                          hasDetails ? () => toggleExpanded(ev.id) : undefined
                        }
                        onKeyDown={
                          hasDetails
                            ? (e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  toggleExpanded(ev.id);
                                }
                              }
                            : undefined
                        }
                        className={cn(
                          "flex items-center justify-between gap-2.5 px-3.5 py-2.5",
                          hasDetails &&
                            "cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div
                            className={cn(
                              "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                              getEntityIconBoxClass(ev.entityType)
                            )}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </div>

                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                                {ev.entityLabel}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                  getActionBadgeClass(ev.action)
                                )}
                              >
                                {AUDIT_ACTION_LABELS[ev.action]}
                              </span>
                              {ev.isReverted && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                                  Revertido
                                </span>
                              )}
                              <span className="font-mono text-[10px] text-slate-400 tabular-nums dark:text-slate-500">
                                {formatTime(ev.createdAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {summary}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {ev.canRevert && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmEvent(ev);
                              }}
                              title="Reverter evento"
                              className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-950"
                            >
                              <RotateCcw className="h-3 w-3" />
                              <span className="hidden sm:inline">Reverter</span>
                            </button>
                          )}
                          {hasDetails && (
                            <ChevronDown
                              className={cn(
                                "h-4 w-4 text-slate-400 transition-transform dark:text-slate-500",
                                isExpanded && "rotate-180 text-emerald-600"
                              )}
                            />
                          )}
                        </div>
                      </div>

                      {/* Expanded Diffs & Optional Non-Revertible Reason */}
                      {isExpanded && hasDetails && (
                        <div className="border-t border-slate-100 bg-slate-50/70 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
                          {diffs.length > 0 && (
                            <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {diffs.map((field) => (
                                <div
                                  key={field.key}
                                  className="flex items-center justify-between gap-2 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs dark:bg-slate-900/80"
                                >
                                  <dt className="font-medium text-slate-500 dark:text-slate-400">
                                    {field.label}
                                  </dt>
                                  <dd className="flex items-center gap-1 font-mono text-[11px] font-medium">
                                    {field.before !== null &&
                                    field.after !== null ? (
                                      <>
                                        <span className="text-rose-600 line-through dark:text-rose-400">
                                          {field.before}
                                        </span>
                                        <ArrowRight className="h-3 w-3 text-slate-400" />
                                        <span className="text-emerald-700 dark:text-emerald-400">
                                          {field.after}
                                        </span>
                                      </>
                                    ) : field.after !== null ? (
                                      <span className="text-emerald-700 dark:text-emerald-400">
                                        {field.after}
                                      </span>
                                    ) : (
                                      <span className="text-rose-600 line-through dark:text-rose-400">
                                        {field.before}
                                      </span>
                                    )}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}

                          {!ev.canRevert && ev.cannotRevertReason && (
                            <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                              {ev.cannotRevertReason}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Load More */}
          {nextCursor && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() =>
                  void fetchEvents({ cursor: nextCursor, append: true })
                }
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  "Carregar mais"
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Revert Confirmation Modal */}
      {confirmEvent && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-xs sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revert-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="revert-modal-title"
                  className="text-base font-bold text-slate-900 dark:text-slate-100"
                >
                  Reverter {confirmEvent.entityLabel}?
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {AUDIT_ENTITY_LABELS[confirmEvent.entityType]}
                </p>
              </div>
              <button
                type="button"
                disabled={reverting}
                onClick={() => setConfirmEvent(null)}
                aria-label="Fechar modal"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
              {buildRevertDescription(
                confirmEvent.entityType,
                confirmEvent.beforeState,
                confirmEvent.afterState
              )}
            </p>

            {confirmDiffs.length > 0 && (
              <div className="mt-3 max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                {confirmDiffs.map((field) => (
                  <div
                    key={field.key}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-slate-500 dark:text-slate-400">
                      {field.label}
                    </span>
                    <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium">
                      {field.before !== null && field.after !== null ? (
                        <>
                          <span className="text-slate-500 line-through">
                            {field.before}
                          </span>
                          <ArrowRight className="h-3 w-3 text-slate-400" />
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {field.after}
                          </span>
                        </>
                      ) : field.after !== null ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          {field.after}
                        </span>
                      ) : (
                        <span className="text-rose-700 dark:text-rose-400">
                          Remover: {field.before}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={reverting}
                onClick={() => setConfirmEvent(null)}
                className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reverting}
                onClick={() => void handleConfirmRevert()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-amber-700 disabled:opacity-60"
              >
                {reverting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Revertendo...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reverter
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
