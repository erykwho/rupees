import {
  type AllocationGoal,
  type Asset,
  type AuditAction,
  type AuditEntityType,
  type AuditEvent,
  Prisma,
  type Transaction,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type AssetSnapshot,
  type AuditActionKey,
  type AuditEntityTypeKey,
  type AuditEventDTO,
  type AuditSnapshot,
  type GoalSnapshot,
  TRANSACTION_TYPE_LABELS,
  type TransactionSnapshot,
  evaluateRevertEligibility,
} from "@/lib/domain/audit";
import type {
  AssetClassKey,
  CurrencyCode,
  PriceModeKey,
  TransactionTypeKey,
} from "@/lib/domain/types";

type TxClient = Prisma.TransactionClient;

export type TransactionWithAssetInfo = Transaction & {
  asset: {
    id: string;
    ticker: string;
    assetClass: string;
    currency: string;
  };
};

export function toAssetSnapshot(
  asset: Asset,
  cascadeTransactions?: TransactionSnapshot[]
): AssetSnapshot {
  const snapshot: AssetSnapshot = {
    id: asset.id,
    ticker: asset.ticker,
    assetClass: asset.assetClass as AssetClassKey,
    sector: asset.sector,
    currency: asset.currency as CurrencyCode,
    targetPctInClass: Number(asset.targetPctInClass),
    priceMode: asset.priceMode as PriceModeKey,
    manualPrice: asset.manualPrice !== null ? Number(asset.manualPrice) : null,
    isActive: asset.isActive,
    fixedIncomeIndex: asset.fixedIncomeIndex ?? null,
    fixedIncomeRate:
      asset.fixedIncomeRate !== null ? Number(asset.fixedIncomeRate) : null,
    maturityDate: asset.maturityDate
      ? asset.maturityDate.toISOString().slice(0, 10)
      : null,
    taxExempt: asset.taxExempt,
  };
  if (cascadeTransactions && cascadeTransactions.length > 0) {
    snapshot.cascadeTransactions = cascadeTransactions;
  }
  return snapshot;
}

export function toTransactionSnapshot(
  tx: TransactionWithAssetInfo
): TransactionSnapshot {
  return {
    id: tx.id,
    assetId: tx.assetId,
    assetTicker: tx.asset.ticker,
    assetClass: tx.asset.assetClass as AssetClassKey,
    currency: tx.asset.currency as CurrencyCode,
    date: tx.date.toISOString(),
    type: tx.type as TransactionTypeKey,
    quantity: Number(tx.quantity),
    unitPrice: Number(tx.unitPrice),
    totalAmount: Number(tx.totalAmount),
    fixedIncomeRate:
      tx.fixedIncomeRate !== null ? Number(tx.fixedIncomeRate) : null,
    notes: tx.notes,
  };
}

export function toGoalSnapshot(goal: AllocationGoal): GoalSnapshot {
  return {
    id: goal.id,
    fixedIncomePct: Number(goal.fixedIncomePct),
    variableIncomePct: Number(goal.variableIncomePct),
    brazilPct: Number(goal.brazilPct),
    usaPct: Number(goal.usaPct),
    brStocksPct: Number(goal.brStocksPct),
    brFiisPct: Number(goal.brFiisPct),
    usStocksPct: Number(goal.usStocksPct),
    usReitsPct: Number(goal.usReitsPct),
  };
}

export function buildTransactionEntityLabel(tx: {
  assetTicker: string;
  type: TransactionTypeKey;
}): string {
  return `${tx.assetTicker} (${TRANSACTION_TYPE_LABELS[tx.type]})`;
}

function toJsonValue(
  value: AuditSnapshot | null
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === null) return Prisma.DbNull;
  return value as unknown as Prisma.InputJsonValue;
}

function parseSnapshot(value: Prisma.JsonValue | null): AuditSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as unknown as AuditSnapshot;
}

export async function recordAuditEvent(
  tx: TxClient,
  input: {
    userId: string;
    entityType: AuditEntityType;
    entityId: string;
    entityLabel: string;
    action: AuditAction;
    beforeState: AuditSnapshot | null;
    afterState: AuditSnapshot | null;
    revertsEventId?: string | null;
    createdAt?: Date;
  }
): Promise<AuditEvent> {
  return tx.auditEvent.create({
    data: {
      userId: input.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      action: input.action,
      beforeState: toJsonValue(input.beforeState),
      afterState: toJsonValue(input.afterState),
      revertsEventId: input.revertsEventId ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

/**
 * Gera eventos sintéticos de CREATE para ativos, lançamentos e objetivos
 * já existentes caso o usuário ainda não possua nenhum registro em AuditEvent.
 * Operação idempotente e rápida (1 consulta indexada após o backfill inicial).
 */
export async function ensureAuditBackfill(userId: string): Promise<void> {
  const existing = await prisma.auditEvent.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    const doubleCheck = await tx.auditEvent.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (doubleCheck) return;

    const [assets, transactions, goal] = await Promise.all([
      tx.asset.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      tx.transaction.findMany({
        where: { userId },
        include: {
          asset: {
            select: {
              id: true,
              ticker: true,
              assetClass: true,
              currency: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
      tx.allocationGoal.findUnique({ where: { userId } }),
    ]);

    const rows: Prisma.AuditEventCreateManyInput[] = [];

    if (goal) {
      rows.push({
        userId,
        entityType: "GOAL",
        entityId: goal.id,
        entityLabel: "Objetivos de Alocação",
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(toGoalSnapshot(goal)),
        createdAt: goal.updatedAt,
      });
    }

    for (const asset of assets) {
      rows.push({
        userId,
        entityType: "ASSET",
        entityId: asset.id,
        entityLabel: asset.ticker,
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(toAssetSnapshot(asset)),
        createdAt: asset.createdAt,
      });
    }

    for (const t of transactions) {
      const snap = toTransactionSnapshot(t);
      rows.push({
        userId,
        entityType: "TRANSACTION",
        entityId: t.id,
        entityLabel: buildTransactionEntityLabel(snap),
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(snap),
        createdAt: t.createdAt,
      });
    }

    if (rows.length > 0) {
      await tx.auditEvent.createMany({ data: rows });
    }
  });
}

export interface ListAuditEventsParams {
  entityType?: AuditEntityTypeKey | "ALL";
  action?: AuditActionKey | "ALL";
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ListAuditEventsResult {
  events: AuditEventDTO[];
  nextCursor: string | null;
  totalCount: number;
}

export async function listAuditEvents(
  userId: string,
  params: ListAuditEventsParams = {}
): Promise<ListAuditEventsResult> {
  await ensureAuditBackfill(userId);

  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const query = params.q?.trim();

  const where: Prisma.AuditEventWhereInput = {
    userId,
    ...(params.entityType && params.entityType !== "ALL"
      ? { entityType: params.entityType }
      : {}),
    ...(params.action && params.action !== "ALL"
      ? { action: params.action }
      : {}),
    ...(query
      ? {
          entityLabel: {
            contains: query,
            mode: "insensitive",
          },
        }
      : {}),
  };

  const [totalCount, rawEvents] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(params.cursor
        ? {
            cursor: { id: params.cursor },
            skip: 1,
          }
        : {}),
      include: {
        revertedBy: {
          select: { id: true },
          take: 1,
        },
      },
    }),
  ]);

  const hasMore = rawEvents.length > limit;
  const pageEvents = hasMore ? rawEvents.slice(0, limit) : rawEvents;
  const nextCursor = hasMore ? pageEvents[pageEvents.length - 1]?.id ?? null : null;

  if (pageEvents.length === 0) {
    return { events: [], nextCursor: null, totalCount };
  }

  // Coleta entidades únicas presentes na página para avaliar elegibilidade de reversão em lote
  const entityIdsByType: Record<AuditEntityTypeKey, Set<string>> = {
    ASSET: new Set(),
    TRANSACTION: new Set(),
    GOAL: new Set(),
  };
  const relevantParentAssetIds = new Set<string>();
  const relevantTickers = new Set<string>();

  for (const ev of pageEvents) {
    entityIdsByType[ev.entityType as AuditEntityTypeKey].add(ev.entityId);
    const before = parseSnapshot(ev.beforeState);
    if (ev.entityType === "TRANSACTION" && before) {
      relevantParentAssetIds.add((before as TransactionSnapshot).assetId);
    }
    if (ev.entityType === "ASSET" && before) {
      relevantTickers.add((before as AssetSnapshot).ticker);
    }
  }

  const allEntityIds = [
    ...entityIdsByType.ASSET,
    ...entityIdsByType.TRANSACTION,
    ...entityIdsByType.GOAL,
  ];

  const [
    latestEventsForEntities,
    existingAssets,
    existingTransactions,
    existingGoal,
    assetTxRows,
  ] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        userId,
        entityId: { in: allEntityIds },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["entityType", "entityId"],
      select: { id: true, entityType: true, entityId: true },
    }),
    prisma.asset.findMany({
      where: {
        userId,
        OR: [
          ...(entityIdsByType.ASSET.size > 0
            ? [{ id: { in: [...entityIdsByType.ASSET] } }]
            : []),
          ...(relevantParentAssetIds.size > 0
            ? [{ id: { in: [...relevantParentAssetIds] } }]
            : []),
          ...(relevantTickers.size > 0
            ? [{ ticker: { in: [...relevantTickers] } }]
            : []),
        ],
      },
      select: { id: true, ticker: true },
    }),
    entityIdsByType.TRANSACTION.size > 0
      ? prisma.transaction.findMany({
          where: {
            userId,
            id: { in: [...entityIdsByType.TRANSACTION] },
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    entityIdsByType.GOAL.size > 0
      ? prisma.allocationGoal.findUnique({
          where: { userId },
          select: { id: true },
        })
      : Promise.resolve(null),
    entityIdsByType.ASSET.size > 0
      ? prisma.transaction.findMany({
          where: {
            userId,
            assetId: { in: [...entityIdsByType.ASSET] },
          },
          select: { id: true, assetId: true },
        })
      : Promise.resolve([]),
  ]);

  const latestEventIdMap = new Map<string, string>();
  for (const le of latestEventsForEntities) {
    latestEventIdMap.set(`${le.entityType}:${le.entityId}`, le.id);
  }

  const existingAssetIdSet = new Set(existingAssets.map((a) => a.id));
  const tickerToAssetId = new Map(existingAssets.map((a) => [a.ticker, a.id]));
  const existingTxIdSet = new Set(existingTransactions.map((t) => t.id));
  const txIdsByAssetId = new Map<string, string[]>();
  for (const row of assetTxRows) {
    const arr = txIdsByAssetId.get(row.assetId) ?? [];
    arr.push(row.id);
    txIdsByAssetId.set(row.assetId, arr);
  }

  const events: AuditEventDTO[] = pageEvents.map((ev) => {
    const entityType = ev.entityType as AuditEntityTypeKey;
    const action = ev.action as AuditActionKey;
    const beforeState = parseSnapshot(ev.beforeState);
    const afterState = parseSnapshot(ev.afterState);
    const isReverted = ev.revertedBy.length > 0;
    const isLatestForEntity =
      latestEventIdMap.get(`${entityType}:${ev.entityId}`) === ev.id;

    let currentEntityExists = false;
    let parentAssetExists: boolean | undefined;
    let tickerConflictExists: boolean | undefined;
    let currentAssetTransactionIds: string[] | undefined;

    if (entityType === "ASSET") {
      currentEntityExists = existingAssetIdSet.has(ev.entityId);
      currentAssetTransactionIds = txIdsByAssetId.get(ev.entityId) ?? [];
      if (beforeState) {
        const beforeTicker = (beforeState as AssetSnapshot).ticker;
        const ownerId = tickerToAssetId.get(beforeTicker);
        tickerConflictExists = ownerId !== undefined && ownerId !== ev.entityId;
      }
    } else if (entityType === "TRANSACTION") {
      currentEntityExists = existingTxIdSet.has(ev.entityId);
      if (beforeState) {
        parentAssetExists = existingAssetIdSet.has(
          (beforeState as TransactionSnapshot).assetId
        );
      }
    } else if (entityType === "GOAL") {
      currentEntityExists = existingGoal?.id === ev.entityId;
    }

    const eligibility = evaluateRevertEligibility({
      entityType,
      action,
      beforeState,
      afterState,
      isLatestForEntity,
      isReverted,
      currentEntityExists,
      parentAssetExists,
      tickerConflictExists,
      currentAssetTransactionIds,
    });

    return {
      id: ev.id,
      entityType,
      entityId: ev.entityId,
      entityLabel: ev.entityLabel,
      action,
      beforeState,
      afterState,
      revertsEventId: ev.revertsEventId,
      isReverted,
      canRevert: eligibility.canRevert,
      cannotRevertReason: eligibility.reason,
      createdAt: ev.createdAt.toISOString(),
    };
  });

  return { events, nextCursor, totalCount };
}

export class RevertConflictError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "RevertConflictError";
    this.status = status;
  }
}

export async function revertAuditEvent(
  userId: string,
  eventId: string
): Promise<AuditEvent> {
  return prisma.$transaction(async (tx) => {
    const target = await tx.auditEvent.findFirst({
      where: { id: eventId, userId },
      include: {
        revertedBy: { select: { id: true }, take: 1 },
      },
    });

    if (!target) {
      throw new RevertConflictError("Evento não encontrado.", 404);
    }

    const entityType = target.entityType as AuditEntityTypeKey;
    const action = target.action as AuditActionKey;
    const beforeState = parseSnapshot(target.beforeState);
    const afterState = parseSnapshot(target.afterState);

    const latestForEntity = await tx.auditEvent.findFirst({
      where: {
        userId,
        entityType: target.entityType,
        entityId: target.entityId,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });

    const isLatestForEntity = latestForEntity?.id === target.id;
    const isReverted = target.revertedBy.length > 0;

    let currentEntityExists = false;
    let parentAssetExists: boolean | undefined;
    let tickerConflictExists: boolean | undefined;
    let currentAssetTransactionIds: string[] | undefined;

    if (entityType === "ASSET") {
      const currentAsset = await tx.asset.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true },
      });
      currentEntityExists = Boolean(currentAsset);

      const assetTxs = await tx.transaction.findMany({
        where: { assetId: target.entityId, userId },
        select: { id: true },
      });
      currentAssetTransactionIds = assetTxs.map((t) => t.id);

      if (beforeState) {
        const conflict = await tx.asset.findFirst({
          where: {
            userId,
            ticker: (beforeState as AssetSnapshot).ticker,
            id: { not: target.entityId },
          },
          select: { id: true },
        });
        tickerConflictExists = Boolean(conflict);
      }
    } else if (entityType === "TRANSACTION") {
      const currentTx = await tx.transaction.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true },
      });
      currentEntityExists = Boolean(currentTx);

      if (beforeState) {
        const parent = await tx.asset.findFirst({
          where: { id: (beforeState as TransactionSnapshot).assetId, userId },
          select: { id: true },
        });
        parentAssetExists = Boolean(parent);
      }
    } else if (entityType === "GOAL") {
      const currentGoal = await tx.allocationGoal.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true },
      });
      currentEntityExists = Boolean(currentGoal);
    }

    const eligibility = evaluateRevertEligibility({
      entityType,
      action,
      beforeState,
      afterState,
      isLatestForEntity,
      isReverted,
      currentEntityExists,
      parentAssetExists,
      tickerConflictExists,
      currentAssetTransactionIds,
    });

    if (!eligibility.canRevert) {
      throw new RevertConflictError(
        eligibility.reason ?? "Este evento não pode ser revertido no momento.",
        409
      );
    }

    // Executa a operação inversa de forma atômica
    let nextLabel = target.entityLabel;
    let nextBeforeState: AuditSnapshot | null = afterState;
    let nextAfterState: AuditSnapshot | null = beforeState;

    if (entityType === "ASSET") {
      const before = beforeState as AssetSnapshot | null;
      const after = afterState as AssetSnapshot | null;

      if (!before && after) {
        // Desfazer criação ou restauração -> exclui o ativo (e eventuais transações restauradas em cascata)
        const currentAsset = await tx.asset.findFirstOrThrow({
          where: { id: target.entityId, userId },
        });
        const cascadeTxs = await tx.transaction.findMany({
          where: { assetId: target.entityId, userId },
          include: {
            asset: {
              select: { id: true, ticker: true, assetClass: true, currency: true },
            },
          },
        });
        nextBeforeState = toAssetSnapshot(
          currentAsset,
          cascadeTxs.map(toTransactionSnapshot)
        );
        nextAfterState = null;
        nextLabel = currentAsset.ticker;
        await tx.asset.delete({ where: { id: target.entityId } });
      } else if (before && !after) {
        // Desfazer exclusão -> recria o ativo e seus lançamentos em cascata
        await tx.asset.create({
          data: {
            id: before.id,
            userId,
            ticker: before.ticker,
            assetClass: before.assetClass,
            sector: before.sector,
            currency: before.currency,
            targetPctInClass: before.targetPctInClass,
            priceMode: before.priceMode,
            manualPrice: before.manualPrice,
            isActive: before.isActive,
            fixedIncomeIndex: before.fixedIncomeIndex ?? null,
            fixedIncomeRate: before.fixedIncomeRate ?? null,
            maturityDate: before.maturityDate
              ? new Date(`${before.maturityDate.slice(0, 10)}T12:00:00.000Z`)
              : null,
            taxExempt: Boolean(before.taxExempt),
          },
        });

        if (before.cascadeTransactions && before.cascadeTransactions.length > 0) {
          await tx.transaction.createMany({
            data: before.cascadeTransactions.map((t) => ({
              id: t.id,
              userId,
              assetId: before.id,
              date: new Date(t.date),
              type: t.type,
              quantity: t.quantity,
              unitPrice: t.unitPrice,
              totalAmount: t.totalAmount,
              fixedIncomeRate: t.fixedIncomeRate ?? null,
              notes: t.notes,
            })),
          });
        }

        nextBeforeState = null;
        nextAfterState = before;
        nextLabel = before.ticker;
      } else if (before && after) {
        // Desfazer edição -> restaura campos anteriores
        const updated = await tx.asset.update({
          where: { id: target.entityId },
          data: {
            ticker: before.ticker,
            assetClass: before.assetClass,
            sector: before.sector,
            currency: before.currency,
            targetPctInClass: before.targetPctInClass,
            priceMode: before.priceMode,
            manualPrice: before.manualPrice,
            isActive: before.isActive,
            fixedIncomeIndex: before.fixedIncomeIndex ?? null,
            fixedIncomeRate: before.fixedIncomeRate ?? null,
            maturityDate: before.maturityDate
              ? new Date(`${before.maturityDate.slice(0, 10)}T12:00:00.000Z`)
              : null,
            taxExempt: Boolean(before.taxExempt),
          },
        });
        nextLabel = updated.ticker;
        nextAfterState = toAssetSnapshot(updated);
      }
    } else if (entityType === "TRANSACTION") {
      const before = beforeState as TransactionSnapshot | null;
      const after = afterState as TransactionSnapshot | null;

      if (!before && after) {
        // Desfazer criação -> exclui lançamento
        await tx.transaction.delete({ where: { id: target.entityId } });
        nextLabel = buildTransactionEntityLabel(after);
      } else if (before && !after) {
        // Desfazer exclusão -> recria lançamento
        await tx.transaction.create({
          data: {
            id: before.id,
            userId,
            assetId: before.assetId,
            date: new Date(before.date),
            type: before.type,
            quantity: before.quantity,
            unitPrice: before.unitPrice,
            totalAmount: before.totalAmount,
            fixedIncomeRate: before.fixedIncomeRate ?? null,
            notes: before.notes,
          },
        });
        nextLabel = buildTransactionEntityLabel(before);
      } else if (before && after) {
        // Desfazer edição -> restaura campos anteriores
        const updated = await tx.transaction.update({
          where: { id: target.entityId },
          data: {
            assetId: before.assetId,
            date: new Date(before.date),
            type: before.type,
            quantity: before.quantity,
            unitPrice: before.unitPrice,
            totalAmount: before.totalAmount,
            notes: before.notes,
          },
          include: {
            asset: {
              select: { id: true, ticker: true, assetClass: true, currency: true },
            },
          },
        });
        const snap = toTransactionSnapshot(updated);
        nextLabel = buildTransactionEntityLabel(snap);
        nextAfterState = snap;
      }
    } else if (entityType === "GOAL") {
      const before = beforeState as GoalSnapshot;
      const updated = await tx.allocationGoal.update({
        where: { id: target.entityId },
        data: {
          fixedIncomePct: before.fixedIncomePct,
          variableIncomePct: before.variableIncomePct,
          brazilPct: before.brazilPct,
          usaPct: before.usaPct,
          brStocksPct: before.brStocksPct,
          brFiisPct: before.brFiisPct,
          usStocksPct: before.usStocksPct,
          usReitsPct: before.usReitsPct,
        },
      });
      nextLabel = "Objetivos de Alocação";
      nextAfterState = toGoalSnapshot(updated);
    }

    const revertEvent = await recordAuditEvent(tx, {
      userId,
      entityType: target.entityType,
      entityId: target.entityId,
      entityLabel: nextLabel,
      action: "REVERT",
      beforeState: nextBeforeState,
      afterState: nextAfterState,
      revertsEventId: target.id,
    });

    return revertEvent;
  });
}
