import {
  ASSET_CLASS_LABELS,
  type AssetClassKey,
  type CurrencyCode,
  FIXED_INCOME_INDEX_LABELS,
  type FixedIncomeIndexKey,
  type PriceModeKey,
  type TransactionTypeKey,
  type VariableIncomeClassKey,
  formatCurrency,
  formatPct,
  formatQty,
} from "./types";
import { MASKED_BRL, MASKED_QTY, MASKED_USD } from "../privacy";

export type AuditEntityTypeKey =
  | "ASSET"
  | "TRANSACTION"
  | "GOAL"
  | "SECTOR_GOAL";
export type AuditActionKey = "CREATE" | "UPDATE" | "DELETE" | "REVERT";

export const AUDIT_ENTITY_LABELS: Record<AuditEntityTypeKey, string> = {
  ASSET: "Carteira",
  TRANSACTION: "Lançamentos",
  GOAL: "Objetivos",
  SECTOR_GOAL: "Setores",
};

export const AUDIT_ACTION_LABELS: Record<AuditActionKey, string> = {
  CREATE: "Criação",
  UPDATE: "Edição",
  DELETE: "Exclusão",
  REVERT: "Reversão",
};

export const TRANSACTION_TYPE_LABELS: Record<TransactionTypeKey, string> = {
  BUY: "Compra",
  SELL: "Venda",
  BALANCE_ADJUSTMENT: "Ajuste de saldo",
};

export const PRICE_MODE_LABELS: Record<PriceModeKey, string> = {
  AUTO_YAHOO: "Automático (Yahoo)",
  MANUAL: "Manual",
};

export interface TransactionSnapshot {
  id: string;
  assetId: string;
  assetTicker: string;
  assetClass: AssetClassKey;
  currency: CurrencyCode;
  date: string;
  type: TransactionTypeKey;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  fixedIncomeRate?: number | null;
  notes: string | null;
}

export interface AssetSnapshot {
  id: string;
  ticker: string;
  assetClass: AssetClassKey;
  sector: string;
  currency: CurrencyCode;
  targetPctInClass: number;
  priceMode: PriceModeKey;
  manualPrice: number | null;
  isActive: boolean;
  fixedIncomeIndex?: FixedIncomeIndexKey | null;
  fixedIncomeRate?: number | null;
  maturityDate?: string | null;
  taxExempt?: boolean;
  cascadeTransactions?: TransactionSnapshot[];
}

export interface GoalSnapshot {
  id: string;
  fixedIncomePct: number;
  variableIncomePct: number;
  brazilPct: number;
  usaPct: number;
  brStocksPct: number;
  brFiisPct: number;
  usStocksPct: number;
  usReitsPct: number;
}

export interface SectorGoalSnapshot {
  id: string;
  assetClass: VariableIncomeClassKey;
  name: string;
  targetPct: number;
}

export type AuditSnapshot =
  | AssetSnapshot
  | TransactionSnapshot
  | GoalSnapshot
  | SectorGoalSnapshot;

export interface AuditDiffField {
  key: string;
  label: string;
  before: string | null;
  after: string | null;
  sensitive: boolean;
}

export interface AuditEventDTO {
  id: string;
  entityType: AuditEntityTypeKey;
  entityId: string;
  entityLabel: string;
  action: AuditActionKey;
  beforeState: AuditSnapshot | null;
  afterState: AuditSnapshot | null;
  revertsEventId: string | null;
  isReverted: boolean;
  canRevert: boolean;
  cannotRevertReason: string | null;
  createdAt: string;
}

export interface RevertEligibility {
  canRevert: boolean;
  reason: string | null;
}

export interface RevertEligibilityInput {
  entityType: AuditEntityTypeKey;
  action: AuditActionKey;
  beforeState: AuditSnapshot | null;
  afterState: AuditSnapshot | null;
  isLatestForEntity: boolean;
  isReverted: boolean;
  currentEntityExists: boolean;
  parentAssetExists?: boolean;
  tickerConflictExists?: boolean;
  currentAssetTransactionIds?: string[];
  sectorNameConflictExists?: boolean;
  sectorHasLinkedAssets?: boolean;
}

function formatMaskedCurrency(
  value: number | null | undefined,
  currency: CurrencyCode,
  isPrivate: boolean
): string | null {
  if (value === null || value === undefined) return null;
  if (isPrivate) {
    return currency === "USD" ? MASKED_USD : MASKED_BRL;
  }
  return formatCurrency(value, currency);
}

function formatMaskedQty(
  value: number | null | undefined,
  assetClass: AssetClassKey | undefined,
  isPrivate: boolean
): string | null {
  if (value === null || value === undefined) return null;
  if (isPrivate) return MASKED_QTY;
  return formatQty(value, assetClass);
}

function formatDatePtBR(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const datePart = isoDate.slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function numbersEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(a - b) < 1e-8;
}

export function computeAuditDiffs(
  entityType: AuditEntityTypeKey,
  beforeState: AuditSnapshot | null,
  afterState: AuditSnapshot | null,
  options?: { isPrivate?: boolean }
): AuditDiffField[] {
  const isPrivate = options?.isPrivate ?? false;

  if (entityType === "ASSET") {
    const before = beforeState as AssetSnapshot | null;
    const after = afterState as AssetSnapshot | null;
    const currency = after?.currency ?? before?.currency ?? "BRL";
    const diffs: AuditDiffField[] = [];

    const pushIfChanged = (
      key: string,
      label: string,
      rawEqual: boolean,
      beforeStr: string | null,
      afterStr: string | null,
      sensitive = false
    ) => {
      if (before && after && rawEqual) return;
      if (beforeStr === null && afterStr === null) return;
      diffs.push({ key, label, before: beforeStr, after: afterStr, sensitive });
    };

    pushIfChanged(
      "ticker",
      "Ticker",
      before?.ticker === after?.ticker,
      before?.ticker ?? null,
      after?.ticker ?? null
    );
    pushIfChanged(
      "assetClass",
      "Classe",
      before?.assetClass === after?.assetClass,
      before ? ASSET_CLASS_LABELS[before.assetClass] : null,
      after ? ASSET_CLASS_LABELS[after.assetClass] : null
    );
    pushIfChanged(
      "sector",
      "Setor",
      before?.sector === after?.sector,
      before?.sector ?? null,
      after?.sector ?? null
    );
    pushIfChanged(
      "targetPctInClass",
      "Meta na classe",
      numbersEqual(before?.targetPctInClass, after?.targetPctInClass),
      before ? formatPct(before.targetPctInClass, 1) : null,
      after ? formatPct(after.targetPctInClass, 1) : null
    );
    pushIfChanged(
      "priceMode",
      "Modo de preço",
      before?.priceMode === after?.priceMode,
      before ? PRICE_MODE_LABELS[before.priceMode] : null,
      after ? PRICE_MODE_LABELS[after.priceMode] : null
    );
    pushIfChanged(
      "manualPrice",
      "Preço manual",
      numbersEqual(before?.manualPrice, after?.manualPrice),
      formatMaskedCurrency(before?.manualPrice, currency, isPrivate),
      formatMaskedCurrency(after?.manualPrice, currency, isPrivate),
      true
    );
    pushIfChanged(
      "isActive",
      "Status",
      before?.isActive === after?.isActive,
      before ? (before.isActive ? "Ativo" : "Inativo") : null,
      after ? (after.isActive ? "Ativo" : "Inativo") : null
    );
    pushIfChanged(
      "fixedIncomeIndex",
      "Indexador",
      (before?.fixedIncomeIndex ?? null) === (after?.fixedIncomeIndex ?? null),
      before?.fixedIncomeIndex
        ? FIXED_INCOME_INDEX_LABELS[before.fixedIncomeIndex]
        : null,
      after?.fixedIncomeIndex
        ? FIXED_INCOME_INDEX_LABELS[after.fixedIncomeIndex]
        : null
    );
    pushIfChanged(
      "fixedIncomeRate",
      "Taxa padrão",
      numbersEqual(before?.fixedIncomeRate ?? null, after?.fixedIncomeRate ?? null),
      before?.fixedIncomeRate != null ? formatPct(before.fixedIncomeRate, 2) : null,
      after?.fixedIncomeRate != null ? formatPct(after.fixedIncomeRate, 2) : null
    );
    pushIfChanged(
      "maturityDate",
      "Vencimento",
      (before?.maturityDate ?? null) === (after?.maturityDate ?? null),
      before?.maturityDate ?? null,
      after?.maturityDate ?? null
    );
    pushIfChanged(
      "taxExempt",
      "Isento de IR",
      Boolean(before?.taxExempt) === Boolean(after?.taxExempt),
      before ? (before.taxExempt ? "Sim" : "Não") : null,
      after ? (after.taxExempt ? "Sim" : "Não") : null
    );

    const beforeCascade = before?.cascadeTransactions?.length ?? 0;
    const afterCascade = after?.cascadeTransactions?.length ?? 0;
    if (beforeCascade > 0 || afterCascade > 0) {
      diffs.push({
        key: "cascadeTransactions",
        label: "Lançamentos vinculados",
        before:
          beforeCascade > 0
            ? `${beforeCascade} lançamento${beforeCascade === 1 ? "" : "s"}`
            : null,
        after:
          afterCascade > 0
            ? `${afterCascade} lançamento${afterCascade === 1 ? "" : "s"}`
            : null,
        sensitive: false,
      });
    }

    return diffs;
  }

  if (entityType === "TRANSACTION") {
    const before = beforeState as TransactionSnapshot | null;
    const after = afterState as TransactionSnapshot | null;
    const currency = after?.currency ?? before?.currency ?? "BRL";
    const assetClass = after?.assetClass ?? before?.assetClass;
    const diffs: AuditDiffField[] = [];

    const pushIfChanged = (
      key: string,
      label: string,
      rawEqual: boolean,
      beforeStr: string | null,
      afterStr: string | null,
      sensitive = false
    ) => {
      if (before && after && rawEqual) return;
      if (beforeStr === null && afterStr === null) return;
      diffs.push({ key, label, before: beforeStr, after: afterStr, sensitive });
    };

    pushIfChanged(
      "assetTicker",
      "Ativo",
      before?.assetId === after?.assetId && before?.assetTicker === after?.assetTicker,
      before?.assetTicker ?? null,
      after?.assetTicker ?? null
    );
    pushIfChanged(
      "type",
      "Tipo",
      before?.type === after?.type,
      before ? TRANSACTION_TYPE_LABELS[before.type] : null,
      after ? TRANSACTION_TYPE_LABELS[after.type] : null
    );
    pushIfChanged(
      "date",
      "Data",
      before?.date?.slice(0, 10) === after?.date?.slice(0, 10),
      formatDatePtBR(before?.date),
      formatDatePtBR(after?.date)
    );
    pushIfChanged(
      "quantity",
      "Quantidade",
      numbersEqual(before?.quantity, after?.quantity),
      formatMaskedQty(before?.quantity, before?.assetClass ?? assetClass, isPrivate),
      formatMaskedQty(after?.quantity, after?.assetClass ?? assetClass, isPrivate),
      true
    );
    pushIfChanged(
      "unitPrice",
      "Preço unitário",
      numbersEqual(before?.unitPrice, after?.unitPrice),
      formatMaskedCurrency(before?.unitPrice, before?.currency ?? currency, isPrivate),
      formatMaskedCurrency(after?.unitPrice, after?.currency ?? currency, isPrivate),
      true
    );
    pushIfChanged(
      "totalAmount",
      "Valor total",
      numbersEqual(before?.totalAmount, after?.totalAmount),
      formatMaskedCurrency(before?.totalAmount, before?.currency ?? currency, isPrivate),
      formatMaskedCurrency(after?.totalAmount, after?.currency ?? currency, isPrivate),
      true
    );
    pushIfChanged(
      "notes",
      "Observações",
      (before?.notes ?? "") === (after?.notes ?? ""),
      before?.notes ?? null,
      after?.notes ?? null
    );

    return diffs;
  }

  if (entityType === "SECTOR_GOAL") {
    const before = beforeState as SectorGoalSnapshot | null;
    const after = afterState as SectorGoalSnapshot | null;
    const diffs: AuditDiffField[] = [];

    const pushIfChanged = (
      key: string,
      label: string,
      rawEqual: boolean,
      beforeStr: string | null,
      afterStr: string | null
    ) => {
      if (before && after && rawEqual) return;
      if (beforeStr === null && afterStr === null) return;
      diffs.push({
        key,
        label,
        before: beforeStr,
        after: afterStr,
        sensitive: false,
      });
    };

    pushIfChanged(
      "assetClass",
      "Classe",
      before?.assetClass === after?.assetClass,
      before ? ASSET_CLASS_LABELS[before.assetClass] : null,
      after ? ASSET_CLASS_LABELS[after.assetClass] : null
    );
    pushIfChanged(
      "name",
      "Setor",
      before?.name === after?.name,
      before?.name ?? null,
      after?.name ?? null
    );
    pushIfChanged(
      "targetPct",
      "Meta na classe",
      numbersEqual(before?.targetPct, after?.targetPct),
      before ? formatPct(before.targetPct, 1) : null,
      after ? formatPct(after.targetPct, 1) : null
    );

    return diffs;
  }

  // GOAL
  const before = beforeState as GoalSnapshot | null;
  const after = afterState as GoalSnapshot | null;
  const goalFields: Array<{ key: keyof Omit<GoalSnapshot, "id">; label: string }> = [
    { key: "fixedIncomePct", label: "Renda Fixa" },
    { key: "variableIncomePct", label: "Renda Variável" },
    { key: "brazilPct", label: "Brasil (RV)" },
    { key: "usaPct", label: "EUA (RV)" },
    { key: "brStocksPct", label: "Ações (BR)" },
    { key: "brFiisPct", label: "FIIs (BR)" },
    { key: "usStocksPct", label: "Stocks (EUA)" },
    { key: "usReitsPct", label: "REITs (EUA)" },
  ];

  const diffs: AuditDiffField[] = [];
  for (const field of goalFields) {
    const bVal = before ? before[field.key] : null;
    const aVal = after ? after[field.key] : null;
    if (before && after && numbersEqual(bVal, aVal)) continue;
    diffs.push({
      key: field.key,
      label: field.label,
      before: bVal !== null ? formatPct(bVal, 1) : null,
      after: aVal !== null ? formatPct(aVal, 1) : null,
      sensitive: false,
    });
  }
  return diffs;
}

export function buildEventSummary(
  entityType: AuditEntityTypeKey,
  action: AuditActionKey,
  entityLabel: string,
  beforeState: AuditSnapshot | null,
  afterState: AuditSnapshot | null,
  isPrivate = false
): string {
  if (entityType === "ASSET") {
    const before = beforeState as AssetSnapshot | null;
    const after = afterState as AssetSnapshot | null;
    if (!before && after) {
      const prefix = action === "REVERT" ? "Ativo restaurado" : "Novo ativo";
      const cascadeCount = after.cascadeTransactions?.length ?? 0;
      const cascadeNote =
        cascadeCount > 0
          ? ` (+${cascadeCount} lançamento${cascadeCount === 1 ? "" : "s"})`
          : "";
      return `${prefix}: ${after.ticker} (${ASSET_CLASS_LABELS[after.assetClass]} · Meta ${formatPct(after.targetPctInClass, 1)})${cascadeNote}`;
    }
    if (before && !after) {
      const prefix = action === "REVERT" ? "Criação desfeita" : "Ativo excluído";
      const cascadeCount = before.cascadeTransactions?.length ?? 0;
      const cascadeNote =
        cascadeCount > 0
          ? ` (${cascadeCount} lançamento${cascadeCount === 1 ? "" : "s"} removido${cascadeCount === 1 ? "" : "s"})`
          : "";
      return `${prefix}: ${before.ticker}${cascadeNote}`;
    }
    const diffs = computeAuditDiffs(entityType, beforeState, afterState, { isPrivate });
    if (diffs.length === 0) return `${entityLabel} atualizado`;
    const preview = diffs
      .slice(0, 2)
      .map((d) => `${d.label}: ${d.before ?? "—"} → ${d.after ?? "—"}`)
      .join(" · ");
    return `${after?.ticker ?? entityLabel} · ${preview}${diffs.length > 2 ? ` (+${diffs.length - 2})` : ""}`;
  }

  if (entityType === "TRANSACTION") {
    const before = beforeState as TransactionSnapshot | null;
    const after = afterState as TransactionSnapshot | null;
    if (!before && after) {
      const typeLabel = TRANSACTION_TYPE_LABELS[after.type];
      const total = formatMaskedCurrency(after.totalAmount, after.currency, isPrivate);
      const qty = formatMaskedQty(after.quantity, after.assetClass, isPrivate);
      const verb = action === "REVERT" ? "Lançamento restaurado" : typeLabel;
      return `${verb} de ${qty} ${after.assetTicker} (${total})`;
    }
    if (before && !after) {
      const typeLabel = TRANSACTION_TYPE_LABELS[before.type];
      const total = formatMaskedCurrency(before.totalAmount, before.currency, isPrivate);
      const verb = action === "REVERT" ? "Lançamento desfeito" : `${typeLabel} excluída`;
      return `${verb}: ${before.assetTicker} (${total})`;
    }
    const diffs = computeAuditDiffs(entityType, beforeState, afterState, { isPrivate });
    if (diffs.length === 0) return `Lançamento ${entityLabel} atualizado`;
    const preview = diffs
      .slice(0, 2)
      .map((d) => `${d.label}: ${d.before ?? "—"} → ${d.after ?? "—"}`)
      .join(" · ");
    return `${after?.assetTicker ?? entityLabel} · ${preview}${diffs.length > 2 ? ` (+${diffs.length - 2})` : ""}`;
  }

  if (entityType === "SECTOR_GOAL") {
    const before = beforeState as SectorGoalSnapshot | null;
    const after = afterState as SectorGoalSnapshot | null;
    if (!before && after) {
      const prefix = action === "REVERT" ? "Setor restaurado" : "Novo setor";
      return `${prefix}: ${after.name} (${ASSET_CLASS_LABELS[after.assetClass]} · Meta ${formatPct(after.targetPct, 1)})`;
    }
    if (before && !after) {
      const prefix = action === "REVERT" ? "Criação desfeita" : "Setor excluído";
      return `${prefix}: ${before.name} (${ASSET_CLASS_LABELS[before.assetClass]})`;
    }
    const diffs = computeAuditDiffs(entityType, beforeState, afterState, { isPrivate });
    if (diffs.length === 0) return `${entityLabel} atualizado`;
    const preview = diffs
      .slice(0, 2)
      .map((d) => `${d.label}: ${d.before ?? "—"} → ${d.after ?? "—"}`)
      .join(" · ");
    return `${after?.name ?? entityLabel} · ${preview}${diffs.length > 2 ? ` (+${diffs.length - 2})` : ""}`;
  }

  // GOAL
  if (!beforeState && afterState) {
    const goal = afterState as GoalSnapshot;
    return `Objetivos iniciais: RF ${formatPct(goal.fixedIncomePct, 0)} / RV ${formatPct(goal.variableIncomePct, 0)}`;
  }
  const diffs = computeAuditDiffs(entityType, beforeState, afterState, { isPrivate });
  if (diffs.length === 0) return "Objetivos de alocação atualizados";
  const preview = diffs
    .slice(0, 2)
    .map((d) => `${d.label}: ${d.before ?? "—"} → ${d.after ?? "—"}`)
    .join(" · ");
  return `${preview}${diffs.length > 2 ? ` (+${diffs.length - 2})` : ""}`;
}

export function buildRevertDescription(
  entityType: AuditEntityTypeKey,
  beforeState: AuditSnapshot | null,
  afterState: AuditSnapshot | null
): string {
  if (entityType === "ASSET") {
    const before = beforeState as AssetSnapshot | null;
    const after = afterState as AssetSnapshot | null;
    if (!before && after) {
      const cascadeCount = after.cascadeTransactions?.length ?? 0;
      if (cascadeCount > 0) {
        return `Remover o ativo ${after.ticker} e os ${cascadeCount} lançamento${cascadeCount === 1 ? "" : "s"} restaurado${cascadeCount === 1 ? "" : "s"} com ele.`;
      }
      return `Remover o ativo ${after.ticker} da carteira.`;
    }
    if (before && !after) {
      const cascadeCount = before.cascadeTransactions?.length ?? 0;
      if (cascadeCount > 0) {
        return `Restaurar o ativo ${before.ticker} e seus ${cascadeCount} lançamento${cascadeCount === 1 ? "" : "s"} vinculados.`;
      }
      return `Restaurar o ativo ${before.ticker} na carteira.`;
    }
    return `Restaurar as configurações anteriores do ativo ${before?.ticker ?? ""}.`;
  }

  if (entityType === "TRANSACTION") {
    const before = beforeState as TransactionSnapshot | null;
    const after = afterState as TransactionSnapshot | null;
    if (!before && after) {
      return `Remover o lançamento de ${TRANSACTION_TYPE_LABELS[after.type].toLowerCase()} de ${after.assetTicker}.`;
    }
    if (before && !after) {
      return `Restaurar o lançamento de ${TRANSACTION_TYPE_LABELS[before.type].toLowerCase()} de ${before.assetTicker}.`;
    }
    return `Restaurar os dados anteriores do lançamento de ${before?.assetTicker ?? ""}.`;
  }

  if (entityType === "SECTOR_GOAL") {
    const before = beforeState as SectorGoalSnapshot | null;
    const after = afterState as SectorGoalSnapshot | null;
    if (!before && after) {
      return `Remover o objetivo do setor ${after.name} (${ASSET_CLASS_LABELS[after.assetClass]}).`;
    }
    if (before && !after) {
      return `Restaurar o objetivo do setor ${before.name} (${ASSET_CLASS_LABELS[before.assetClass]}).`;
    }
    return `Restaurar os dados anteriores do setor ${before?.name ?? ""}.`;
  }

  return "Restaurar os percentuais anteriores dos objetivos de alocação.";
}

export function evaluateRevertEligibility(
  input: RevertEligibilityInput
): RevertEligibility {
  if (input.isReverted) {
    return {
      canRevert: false,
      reason: "Este evento já foi revertido.",
    };
  }

  if (!input.isLatestForEntity) {
    return {
      canRevert: false,
      reason:
        "Existe uma alteração mais recente neste item. Reverta a mais recente primeiro.",
    };
  }

  // GOAL initial creation cannot be deleted
  if (input.entityType === "GOAL" && !input.beforeState) {
    return {
      canRevert: false,
      reason:
        "O objetivo inicial não pode ser excluído; edite os percentuais se desejar alterá-lo.",
    };
  }

  // Undoing a creation or restoration (beforeState === null && afterState !== null) -> deletes current entity
  if (!input.beforeState && input.afterState) {
    if (!input.currentEntityExists) {
      return {
        canRevert: false,
        reason: "Este item não existe mais no banco de dados.",
      };
    }

    if (input.entityType === "ASSET") {
      const afterAsset = input.afterState as AssetSnapshot;
      const currentTxIds = input.currentAssetTransactionIds ?? [];
      if (currentTxIds.length > 0) {
        const restoredIds = new Set(
          (afterAsset.cascadeTransactions ?? []).map((t) => t.id)
        );
        const hasExtraTx = currentTxIds.some((id) => !restoredIds.has(id));
        if (input.action === "CREATE" || hasExtraTx) {
          return {
            canRevert: false,
            reason:
              "Este ativo possui lançamentos vinculados. Remova ou reverta os lançamentos antes de desfazer este evento.",
          };
        }
      }
    }

    if (input.entityType === "SECTOR_GOAL" && input.sectorHasLinkedAssets) {
      return {
        canRevert: false,
        reason:
          "Este setor possui ativos vinculados na carteira. Reatribua os ativos antes de desfazer este evento.",
      };
    }

    return { canRevert: true, reason: null };
  }

  // Undoing a deletion (beforeState !== null && afterState === null) -> recreates entity
  if (input.beforeState && !input.afterState) {
    if (input.currentEntityExists) {
      return {
        canRevert: false,
        reason: "Este item já existe novamente na carteira.",
      };
    }

    if (input.entityType === "ASSET") {
      const beforeAsset = input.beforeState as AssetSnapshot;
      if (input.tickerConflictExists) {
        return {
          canRevert: false,
          reason: `Já existe outro ativo com o ticker ${beforeAsset.ticker} na sua carteira.`,
        };
      }
    }

    if (input.entityType === "SECTOR_GOAL") {
      const beforeSector = input.beforeState as SectorGoalSnapshot;
      if (input.sectorNameConflictExists) {
        return {
          canRevert: false,
          reason: `Já existe outro setor chamado "${beforeSector.name}" nesta classe.`,
        };
      }
    }

    if (input.entityType === "TRANSACTION") {
      const beforeTx = input.beforeState as TransactionSnapshot;
      if (!input.parentAssetExists) {
        return {
          canRevert: false,
          reason: `O ativo ${beforeTx.assetTicker} não existe mais. Reverta a exclusão do ativo primeiro.`,
        };
      }
    }

    return { canRevert: true, reason: null };
  }

  // Undoing an update (beforeState !== null && afterState !== null) -> restores beforeState
  if (input.beforeState && input.afterState) {
    if (!input.currentEntityExists) {
      return {
        canRevert: false,
        reason: "Este item não existe mais para ser restaurado.",
      };
    }

    if (input.entityType === "ASSET" && input.tickerConflictExists) {
      const beforeAsset = input.beforeState as AssetSnapshot;
      return {
        canRevert: false,
        reason: `Já existe outro ativo com o ticker ${beforeAsset.ticker} na sua carteira.`,
      };
    }

    if (input.entityType === "SECTOR_GOAL" && input.sectorNameConflictExists) {
      const beforeSector = input.beforeState as SectorGoalSnapshot;
      return {
        canRevert: false,
        reason: `Já existe outro setor chamado "${beforeSector.name}" nesta classe.`,
      };
    }

    if (input.entityType === "TRANSACTION" && !input.parentAssetExists) {
      const beforeTx = input.beforeState as TransactionSnapshot;
      return {
        canRevert: false,
        reason: `O ativo ${beforeTx.assetTicker} não existe mais na carteira.`,
      };
    }

    return { canRevert: true, reason: null };
  }

  return {
    canRevert: false,
    reason: "Evento sem dados suficientes para reversão.",
  };
}
