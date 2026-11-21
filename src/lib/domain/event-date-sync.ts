import type { TransactionTypeKey } from "./types";

export interface SheetAporteRow {
  rowNumber: number;
  ticker: string;
  type: TransactionTypeKey;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  rawDate: string;
  dateKey: string; // YYYY-MM-DD
  targetCreatedAt: Date;
}

export interface AuditEventCandidate {
  id: string;
  entityId: string;
  entityLabel: string;
  createdAt: Date;
  ticker: string;
  type: TransactionTypeKey;
  quantity: number;
  totalAmount: number;
  /** Data do lançamento (Transaction.date ou afterState.date), usada para desempate. */
  transactionDate: Date | null;
}

export interface EventDateMatch {
  eventId: string;
  entityId: string;
  entityLabel: string;
  rowNumber: number;
  ticker: string;
  type: TransactionTypeKey;
  quantity: number;
  totalAmount: number;
  rawDate: string;
  currentCreatedAt: Date;
  targetCreatedAt: Date;
  needsUpdate: boolean;
}

export interface EventDateSyncPlan {
  matches: EventDateMatch[];
  unmatchedSheetRows: SheetAporteRow[];
  unmatchedEvents: AuditEventCandidate[];
}

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export function parseBrNumber(raw: string | undefined): number {
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R\$/gi, "")
    .replace(/\$/g, "")
    .replace(/%/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (!cleaned) return 0;

  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }

  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

export function parseBrDateParts(
  raw: string
): { year: number; month: number; day: number } | null {
  const parts = raw.trim().split("/");
  if (parts.length !== 3) return null;
  const [day, month, year] = parts.map(Number);
  if (
    !Number.isInteger(day) ||
    !Number.isInteger(month) ||
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    year < 1900
  ) {
    return null;
  }
  return { year, month, day };
}

function toDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Faz o parse do CSV da aba "Aportes" usando exatamente as mesmas regras de
 * normalização do `prisma/import-sheets.ts`.
 *
 * O timestamp alvo (`targetCreatedAt`) usa 12:00:00 UTC (09:00 BRT) acrescido
 * de +1 segundo por linha ocorrida no mesmo dia para preservar a ordem da planilha.
 */
export function parseAportesCsv(csvContent: string): SheetAporteRow[] {
  const lines = csvContent.split(/\r?\n/);
  const rows: SheetAporteRow[] = [];
  const dayCounts = new Map<string, number>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim().length === 0) continue;

    const cols = parseCsvLine(line);
    const ticker = cols[0]?.trim().toUpperCase();
    if (!ticker) continue;

    const rawQty = parseBrNumber(cols[1]);
    if (rawQty === 0) continue;

    const rawDate = (cols[2] ?? "").trim();
    const dateParts = parseBrDateParts(rawDate);
    if (!dateParts) continue;

    const rawTotal = parseBrNumber(cols[4]);
    const rawUnit = parseBrNumber(cols[5]);
    const rawType = (cols[8] ?? "").trim().toLowerCase();

    const type: TransactionTypeKey =
      rawType.includes("venda") || rawQty < 0 ? "SELL" : "BUY";
    const quantity = Math.abs(rawQty);
    const totalAmount = Math.abs(rawTotal) || quantity * Math.abs(rawUnit);
    const unitPrice =
      Math.abs(rawUnit) || (quantity > 0 ? totalAmount / quantity : 0);

    const dateKey = toDateKey(dateParts.year, dateParts.month, dateParts.day);
    const offsetSeconds = dayCounts.get(dateKey) ?? 0;
    dayCounts.set(dateKey, offsetSeconds + 1);

    const targetCreatedAt = new Date(
      Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, 12, 0, offsetSeconds)
    );

    rows.push({
      rowNumber: i + 1,
      ticker,
      type,
      quantity,
      unitPrice,
      totalAmount,
      rawDate,
      dateKey,
      targetCreatedAt,
    });
  }

  return rows;
}

function isClose(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function dateKeyFromDate(d: Date | null): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Cruza eventos `CREATE` de `TRANSACTION` com as linhas da aba Aportes da planilha
 * em correspondência 1-para-1.
 *
 * Critério de match:
 * - Mesmo `ticker` (case-insensitive)
 * - Mesmo `type` (`BUY` / `SELL`)
 * - Mesma `quantity` (tolerância 1e-5) e mesmo `totalAmount` (tolerância 0.02)
 *
 * Quando há múltiplos eventos compatíveis (ex: vários aportes iguais de SELIC 500),
 * prioriza o evento cuja `transactionDate` tem o mesmo dia (`YYYY-MM-DD`) da planilha,
 * depois a menor distância em dias, e por fim a ordem original (`createdAt`, `id`).
 */
export function matchAuditEventsWithSheet(
  events: AuditEventCandidate[],
  sheetRows: SheetAporteRow[]
): EventDateSyncPlan {
  const remainingEvents = [...events].sort((a, b) => {
    const aTime = a.transactionDate?.getTime() ?? a.createdAt.getTime();
    const bTime = b.transactionDate?.getTime() ?? b.createdAt.getTime();
    if (aTime !== bTime) return aTime - bTime;
    const cDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (cDiff !== 0) return cDiff;
    return a.id.localeCompare(b.id);
  });

  const usedEventIds = new Set<string>();
  const matches: EventDateMatch[] = [];
  const unmatchedSheetRows: SheetAporteRow[] = [];

  for (const row of sheetRows) {
    const candidates = remainingEvents.filter((ev) => {
      if (usedEventIds.has(ev.id)) return false;
      if (ev.ticker.toUpperCase() !== row.ticker) return false;
      if (ev.type !== row.type) return false;
      if (!isClose(ev.quantity, row.quantity, 1e-5)) return false;
      if (!isClose(ev.totalAmount, row.totalAmount, 0.02)) return false;
      return true;
    });

    if (candidates.length === 0) {
      unmatchedSheetRows.push(row);
      continue;
    }

    candidates.sort((a, b) => {
      const aExactDay = dateKeyFromDate(a.transactionDate) === row.dateKey ? 0 : 1;
      const bExactDay = dateKeyFromDate(b.transactionDate) === row.dateKey ? 0 : 1;
      if (aExactDay !== bExactDay) return aExactDay - bExactDay;

      const aDist = a.transactionDate
        ? Math.abs(a.transactionDate.getTime() - row.targetCreatedAt.getTime())
        : Number.MAX_SAFE_INTEGER;
      const bDist = b.transactionDate
        ? Math.abs(b.transactionDate.getTime() - row.targetCreatedAt.getTime())
        : Number.MAX_SAFE_INTEGER;
      if (aDist !== bDist) return aDist - bDist;

      const cDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (cDiff !== 0) return cDiff;
      return a.id.localeCompare(b.id);
    });

    const chosen = candidates[0];
    usedEventIds.add(chosen.id);

    matches.push({
      eventId: chosen.id,
      entityId: chosen.entityId,
      entityLabel: chosen.entityLabel,
      rowNumber: row.rowNumber,
      ticker: row.ticker,
      type: row.type,
      quantity: row.quantity,
      totalAmount: row.totalAmount,
      rawDate: row.rawDate,
      currentCreatedAt: chosen.createdAt,
      targetCreatedAt: row.targetCreatedAt,
      needsUpdate: chosen.createdAt.getTime() !== row.targetCreatedAt.getTime(),
    });
  }

  const unmatchedEvents = remainingEvents.filter((ev) => !usedEventIds.has(ev.id));

  return {
    matches,
    unmatchedSheetRows,
    unmatchedEvents,
  };
}

export interface BootstrapEventCandidate {
  id: string;
  entityType: "GOAL" | "ASSET";
  entityId: string;
  entityLabel: string;
  createdAt: Date;
  /** `Asset.createdAt` atual no banco (apenas para entityType === "ASSET"). */
  assetCreatedAt?: Date | null;
}

export interface BootstrapDateUpdate {
  eventId: string;
  entityType: "GOAL" | "ASSET";
  entityId: string;
  entityLabel: string;
  currentEventCreatedAt: Date;
  currentAssetCreatedAt: Date | null;
  targetDate: Date;
  eventNeedsUpdate: boolean;
  assetNeedsUpdate: boolean;
}

export interface BootstrapDateSyncPlan {
  baseDate: Date;
  updates: BootstrapDateUpdate[];
  skippedEvents: BootstrapEventCandidate[];
}

/**
 * Calcula a data base para eventos iniciais (GOAL e ASSET):
 * exatamente 1 dia antes da menor data de aporte, às 12:00:00 UTC (09:00 BRT).
 */
export function computePreFirstContributionBaseDate(dates: Date[]): Date | null {
  const valid = dates.filter((d) => !Number.isNaN(d.getTime()));
  if (valid.length === 0) return null;

  let minTime = valid[0].getTime();
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].getTime() < minTime) {
      minTime = valid[i].getTime();
    }
  }

  const minDate = new Date(minTime);
  return new Date(
    Date.UTC(
      minDate.getUTCFullYear(),
      minDate.getUTCMonth(),
      minDate.getUTCDate() - 1,
      12,
      0,
      0
    )
  );
}

/**
 * Seleciona os eventos `CREATE` de `GOAL` e `ASSET` pertencentes ao lote inicial
 * de importação (por padrão, todos ocorridos dentro de `batchWindowMs` — 5 min —
 * a partir do evento mais antigo, ou anteriores a `importedBefore` se informado)
 * e calcula as datas alvo a partir de `baseDate`:
 * - `GOAL` recebe `baseDate` (offset 0s)
 * - Cada `ASSET` recebe `baseDate + (index + 1) * 1s` preservando a ordem original.
 */
export function planBootstrapDateUpdates(params: {
  baseDate: Date;
  events: BootstrapEventCandidate[];
  importedBefore?: Date;
  batchWindowMs?: number;
}): BootstrapDateSyncPlan {
  const { baseDate, events, importedBefore, batchWindowMs = 5 * 60 * 1000 } = params;

  const sorted = [...events].sort((a, b) => {
    const tDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (tDiff !== 0) return tDiff;
    return a.id.localeCompare(b.id);
  });

  if (sorted.length === 0) {
    return { baseDate, updates: [], skippedEvents: [] };
  }

  const cutoffMs = importedBefore
    ? importedBefore.getTime()
    : sorted[0].createdAt.getTime() + batchWindowMs;

  const inBatch: BootstrapEventCandidate[] = [];
  const skippedEvents: BootstrapEventCandidate[] = [];

  for (const ev of sorted) {
    if (ev.createdAt.getTime() <= cutoffMs) {
      inBatch.push(ev);
    } else {
      skippedEvents.push(ev);
    }
  }

  // GOAL primeiro (offset 0), depois ASSET na ordem original (offset 1..N)
  const goalEvents = inBatch.filter((e) => e.entityType === "GOAL");
  const assetEvents = inBatch.filter((e) => e.entityType === "ASSET");
  const orderedBatch = [...goalEvents, ...assetEvents];

  const updates: BootstrapDateUpdate[] = orderedBatch.map((ev, index) => {
    const targetDate = new Date(baseDate.getTime() + index * 1000);
    const currentAssetCreatedAt =
      ev.entityType === "ASSET" ? (ev.assetCreatedAt ?? null) : null;

    return {
      eventId: ev.id,
      entityType: ev.entityType,
      entityId: ev.entityId,
      entityLabel: ev.entityLabel,
      currentEventCreatedAt: ev.createdAt,
      currentAssetCreatedAt,
      targetDate,
      eventNeedsUpdate: ev.createdAt.getTime() !== targetDate.getTime(),
      assetNeedsUpdate:
        ev.entityType === "ASSET" &&
        currentAssetCreatedAt !== null &&
        currentAssetCreatedAt.getTime() !== targetDate.getTime(),
    };
  });

  return {
    baseDate,
    updates,
    skippedEvents,
  };
}

