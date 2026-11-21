import { toISODate } from "./evolution";
import type { TransactionTypeKey } from "./types";

export interface ReversalCleanupTarget {
  pairKey: string;
  ticker: string;
  type: TransactionTypeKey;
  dateISO: string; // YYYY-MM-DD
  quantity: number;
  totalAmount: number;
  reason: string;
}

/**
 * Lançamentos anômalos de março/2025 importados da aba "Aportes":
 * em 03/03/2025 foram registrados R$ 500 na coluna em USD para VOO e VNQ
 * (inflando o preço unitário em ~6x) e em 06/03/2025 ambos foram estornados
 * com quantidade/valor negativos (importados como SELL).
 */
export const MAR_2025_US_REVERSAL_TARGETS: readonly ReversalCleanupTarget[] = [
  {
    pairKey: "VOO-2025-03",
    ticker: "VOO",
    type: "BUY",
    dateISO: "2025-03-03",
    quantity: 0.15969,
    totalAmount: 500,
    reason: "Compra lançada em BRL (500) na coluna USD e estornada em 06/03/2025",
  },
  {
    pairKey: "VOO-2025-03",
    ticker: "VOO",
    type: "SELL",
    dateISO: "2025-03-06",
    quantity: 0.15969,
    totalAmount: 500,
    reason: "Estorno da compra anômala de VOO de 03/03/2025",
  },
  {
    pairKey: "VNQ-2025-03",
    ticker: "VNQ",
    type: "BUY",
    dateISO: "2025-03-03",
    quantity: 0.90279,
    totalAmount: 500,
    reason: "Compra lançada em BRL (500) na coluna USD e estornada em 06/03/2025",
  },
  {
    pairKey: "VNQ-2025-03",
    ticker: "VNQ",
    type: "SELL",
    dateISO: "2025-03-06",
    quantity: 0.90279,
    totalAmount: 500,
    reason: "Estorno da compra anômala de VNQ de 03/03/2025",
  },
] as const;

export interface CleanupTransactionCandidate {
  id: string;
  assetId: string;
  ticker: string;
  date: Date | string;
  type: TransactionTypeKey;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface CleanupAuditEventCandidate {
  id: string;
  entityId: string;
  entityLabel: string;
  action: string;
  createdAt: Date | string;
  snapshot?: {
    ticker: string;
    type: TransactionTypeKey;
    dateISO: string | null;
    quantity: number;
    totalAmount: number;
  } | null;
}

export interface MatchedReversalTransaction {
  target: ReversalCleanupTarget;
  transaction: CleanupTransactionCandidate;
}

export interface ReversalCleanupPlan {
  matchedTransactions: MatchedReversalTransaction[];
  missingTargets: ReversalCleanupTarget[];
  matchedAuditEvents: CleanupAuditEventCandidate[];
  partialPairs: string[];
  warnings: string[];
}

const QTY_TOLERANCE = 1e-5;
const TOTAL_TOLERANCE = 0.01;

function matchesTarget(
  candidate: {
    ticker: string;
    type: TransactionTypeKey;
    dateISO: string | null;
    quantity: number;
    totalAmount: number;
  },
  target: ReversalCleanupTarget
): boolean {
  if (candidate.ticker.toUpperCase() !== target.ticker) return false;
  if (candidate.type !== target.type) return false;
  if (candidate.dateISO !== target.dateISO) return false;
  if (Math.abs(Math.abs(candidate.quantity) - target.quantity) > QTY_TOLERANCE) {
    return false;
  }
  if (
    Math.abs(Math.abs(candidate.totalAmount) - target.totalAmount) >
    TOTAL_TOLERANCE
  ) {
    return false;
  }
  return true;
}

export function planMar2025ReversalCleanup(params: {
  transactions: CleanupTransactionCandidate[];
  auditEvents: CleanupAuditEventCandidate[];
  targets?: readonly ReversalCleanupTarget[];
}): ReversalCleanupPlan {
  const {
    transactions,
    auditEvents,
    targets = MAR_2025_US_REVERSAL_TARGETS,
  } = params;

  const matchedTransactions: MatchedReversalTransaction[] = [];
  const missingTargets: ReversalCleanupTarget[] = [];
  const usedTxIds = new Set<string>();
  const warnings: string[] = [];

  for (const target of targets) {
    const matches = transactions.filter(
      (tx) =>
        !usedTxIds.has(tx.id) &&
        matchesTarget(
          {
            ticker: tx.ticker,
            type: tx.type,
            dateISO: toISODate(tx.date),
            quantity: tx.quantity,
            totalAmount: tx.totalAmount,
          },
          target
        )
    );

    if (matches.length === 0) {
      missingTargets.push(target);
      continue;
    }

    if (matches.length > 1) {
      warnings.push(
        `Encontrados ${matches.length} lançamentos idênticos para ${target.ticker} ${target.type} em ${target.dateISO}; apenas o primeiro (${matches[0].id}) foi selecionado.`
      );
    }

    const chosen = matches[0];
    usedTxIds.add(chosen.id);
    matchedTransactions.push({ target, transaction: chosen });
  }

  // Detect incomplete BUY/SELL pairs so callers can avoid changing final holdings unintentionally
  const expectedCountByPair = new Map<string, number>();
  const matchedCountByPair = new Map<string, number>();

  for (const target of targets) {
    expectedCountByPair.set(
      target.pairKey,
      (expectedCountByPair.get(target.pairKey) ?? 0) + 1
    );
  }
  for (const m of matchedTransactions) {
    matchedCountByPair.set(
      m.target.pairKey,
      (matchedCountByPair.get(m.target.pairKey) ?? 0) + 1
    );
  }

  const partialPairs: string[] = [];
  for (const [pairKey, expected] of expectedCountByPair.entries()) {
    const found = matchedCountByPair.get(pairKey) ?? 0;
    if (found > 0 && found < expected) {
      partialPairs.push(pairKey);
      warnings.push(
        `Par incompleto detectado para ${pairKey} (${found}/${expected} transações encontradas). Remover apenas um lado do par alteraria a posição final do ativo.`
      );
    }
  }

  // Match all AuditEvents linked to matched transactions OR orphaned AuditEvents
  // whose snapshot matches one of the target transactions.
  const matchedTxIds = new Set(matchedTransactions.map((m) => m.transaction.id));
  const matchedAuditEvents: CleanupAuditEventCandidate[] = [];
  const seenAuditIds = new Set<string>();

  for (const ev of auditEvents) {
    if (seenAuditIds.has(ev.id)) continue;

    if (matchedTxIds.has(ev.entityId)) {
      seenAuditIds.add(ev.id);
      matchedAuditEvents.push(ev);
      continue;
    }

    if (ev.snapshot) {
      const matchesAnyTarget = targets.some((t) =>
        matchesTarget(ev.snapshot!, t)
      );
      if (matchesAnyTarget) {
        seenAuditIds.add(ev.id);
        matchedAuditEvents.push(ev);
      }
    }
  }

  return {
    matchedTransactions,
    missingTargets,
    matchedAuditEvents,
    partialPairs,
    warnings,
  };
}
