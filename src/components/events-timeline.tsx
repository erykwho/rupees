"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  History,
  Info,
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
  { value: "ALL", label: "Todos" },
  { value: "ASSET", label: "Carteira" },
  { value: "TRANSACTION", label: "Lançamentos" },
  { value: "GOAL", label: "Objetivos" },
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
  return Target;
}

function getActionBadgeClass(action: AuditActionKey): string {
  switch (action) {
    case "CREATE":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900";
    case "UPDATE":
      return "bg-sky-50 text-sky-700 ring-1 ring-sky-200/80 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900";
    case "DELETE":
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900";
    case "REVERT":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900";
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

  const [entityFilter, setEntityFilter] = useState<AuditEntityTypeKey | "ALL">("ALL");
  const [actionFilter, setActionFilter] = useState<AuditActionKey | "ALL">("ALL");
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
        message: `Evento de "${label}" revertido com sucesso.`,
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

  function toggleExpanded(eventId: string, defaultExpanded: boolean) {
    setExpandedIds((prev) => {
      const current = prev[eventId] ?? defaultExpanded;
      return { ...prev, [eventId]: !current };
    });
  }

  const groupedEvents = useMemo(() => {
    const groups: Array<{ dayKey: string; label: string; items: AuditEventDTO[] }> =
      [];
    const map = new Map<string, { dayKey: string; label: string; items: AuditEventDTO[] }>();

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
    // Preview invertido: o que está agora (afterState) volta a ser beforeState
    return computeAuditDiffs(
      confirmEvent.entityType,
      confirmEvent.afterState,
      confirmEvent.beforeState,
      { isPrivate }
    );
  }, [confirmEvent, isPrivate]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Eventos
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {totalCount} {totalCount === 1 ? "registro" : "registros"}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Histórico completo de alterações na carteira, lançamentos e objetivos, com reversão segura.
          </p>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={cn(
            "flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/80 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-300"
          )}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Fechar aviso"
            className="rounded-lg p-1 opacity-70 transition-opacity hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="space-y-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por ticker ou descrição (ex.: PETR4, Objetivos)..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50/70 py-2.5 pl-10 pr-9 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-100 dark:focus:border-emerald-500 dark:focus:bg-slate-900"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar busca"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Module Pills */}
          <div className="flex flex-wrap gap-1.5">
            {ENTITY_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEntityFilter(opt.value)}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                  entityFilter === opt.value
                    ? "bg-emerald-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Action Pills */}
          <div className="flex flex-wrap gap-1.5">
            {ACTION_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setActionFilter(opt.value)}
                className={cn(
                  "rounded-xl px-2.5 py-1.5 text-xs font-medium transition-colors",
                  actionFilter === opt.value
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                    : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/80 dark:bg-slate-800/80 dark:text-slate-400 dark:hover:bg-slate-700"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="flex items-center justify-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white py-14 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
          Carregando eventos...
        </div>
      ) : groupedEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800">
            <History className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Nenhum evento encontrado
          </p>
          <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
            Ajuste os filtros ou realize alterações na carteira, nos lançamentos ou nos objetivos para vê-las registradas aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedEvents.map((group) => (
            <section key={group.dayKey} className="space-y-3">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {group.label}
                </h2>
                <div className="h-px flex-1 bg-slate-200/80 dark:bg-slate-800" />
              </div>

              <div className="space-y-3">
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
                  const defaultExpanded =
                    (ev.action === "UPDATE" || ev.action === "REVERT") &&
                    diffs.length > 0 &&
                    diffs.length <= 4;
                  const isExpanded = expandedIds[ev.id] ?? defaultExpanded;

                  return (
                    <article
                      key={ev.id}
                      className={cn(
                        "rounded-2xl border bg-white p-4 shadow-2xs transition-colors dark:bg-slate-900",
                        ev.isReverted
                          ? "border-slate-200/60 opacity-80 dark:border-slate-800/70"
                          : "border-slate-200/80 dark:border-slate-800"
                      )}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        {/* Left info */}
                        <div className="flex min-w-0 items-start gap-3">
                          <div
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                              getEntityIconBoxClass(ev.entityType)
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>

                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {ev.entityLabel}
                              </span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {AUDIT_ENTITY_LABELS[ev.entityType]}
                              </span>
                              <span
                                className={cn(
                                  "rounded-md px-2 py-0.5 text-[11px] font-semibold",
                                  getActionBadgeClass(ev.action)
                                )}
                              >
                                {AUDIT_ACTION_LABELS[ev.action]}
                              </span>
                              {ev.isReverted && (
                                <span className="rounded-md bg-slate-200/80 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                  Revertido
                                </span>
                              )}
                              <span className="text-xs text-slate-400 dark:text-slate-500">
                                · {formatTime(ev.createdAt)}
                              </span>
                            </div>

                            <p className="text-sm text-slate-600 dark:text-slate-300">
                              {summary}
                            </p>
                          </div>
                        </div>

                        {/* Right actions */}
                        <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
                          {diffs.length > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(ev.id, defaultExpanded)}
                              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                            >
                              {isExpanded ? (
                                <>
                                  Ocultar
                                  <ChevronUp className="h-3.5 w-3.5" />
                                </>
                              ) : (
                                <>
                                  Detalhes ({diffs.length})
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </>
                              )}
                            </button>
                          )}

                          {ev.canRevert && (
                            <button
                              type="button"
                              onClick={() => setConfirmEvent(ev)}
                              className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 ring-1 ring-amber-200/80 transition-colors hover:bg-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900 dark:hover:bg-amber-950"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Reverter
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Diff details */}
                      {isExpanded && diffs.length > 0 && (
                        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
                          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {diffs.map((field) => (
                              <div
                                key={field.key}
                                className="flex flex-col gap-0.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs dark:bg-slate-900/80"
                              >
                                <dt className="font-medium text-slate-500 dark:text-slate-400">
                                  {field.label}
                                </dt>
                                <dd className="flex flex-wrap items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200">
                                  {field.before !== null && field.after !== null ? (
                                    <>
                                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-400/70 dark:bg-rose-950/50 dark:text-rose-300">
                                        {field.before}
                                      </span>
                                      <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                                      <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                        {field.after}
                                      </span>
                                    </>
                                  ) : field.after !== null ? (
                                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                                      {field.after}
                                    </span>
                                  ) : (
                                    <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-700 line-through decoration-rose-400/70 dark:bg-rose-950/50 dark:text-rose-300">
                                      {field.before}
                                    </span>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}

                      {/* Why it cannot be reverted */}
                      {!ev.canRevert && ev.cannotRevertReason && (
                        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          <Info className="h-3.5 w-3.5 shrink-0" />
                          <span>{ev.cannotRevertReason}</span>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Load More */}
          {nextCursor && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void fetchEvents({ cursor: nextCursor, append: true })}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando...
                  </>
                ) : (
                  "Carregar mais eventos"
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
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <RotateCcw className="h-5 w-5" />
                </div>
                <div>
                  <h3
                    id="revert-modal-title"
                    className="text-base font-bold text-slate-900 dark:text-slate-100"
                  >
                    Confirmar reversão
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {confirmEvent.entityLabel} ·{" "}
                    {AUDIT_ENTITY_LABELS[confirmEvent.entityType]}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={reverting}
                onClick={() => setConfirmEvent(null)}
                aria-label="Fechar modal"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-sm text-slate-700 dark:text-slate-300">
              {buildRevertDescription(
                confirmEvent.entityType,
                confirmEvent.beforeState,
                confirmEvent.afterState
              )}
            </p>

            {confirmDiffs.length > 0 && (
              <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  O que será aplicado
                </p>
                {confirmDiffs.map((field) => (
                  <div
                    key={field.key}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-slate-600 dark:text-slate-400">
                      {field.label}
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
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
                          Restaurar: {field.after}
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

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Um novo evento do tipo <strong>Reversão</strong> será registrado no histórico — você poderá desfazer esta reversão depois se precisar.
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={reverting}
                onClick={() => setConfirmEvent(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={reverting}
                onClick={() => void handleConfirmRevert()}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-2xs transition-colors hover:bg-amber-700 disabled:opacity-60"
              >
                {reverting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Revertendo...
                  </>
                ) : (
                  <>
                    <RotateCcw className="h-4 w-4" />
                    Confirmar reversão
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
