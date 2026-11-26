import {
  type AllocationGoal,
  type Asset,
  type AuditAction,
  type AuditEntityType,
  type AuditEvent,
  Prisma,
  type SavingsGoal,
  type SavingsMovement,
  type SectorGoal,
  type Transaction,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type AssetSnapshot,
  type AuditActionKey,
  type AuditEntityTypeKey,
  type AuditEventDTO,
  type AuditPillarFilter,
  type AuditSnapshot,
  type GoalSnapshot,
  LONG_TERM_AUDIT_ENTITY_TYPES,
  SAVINGS_AUDIT_ENTITY_TYPES,
  type SavingsGoalSnapshot,
  type SavingsMovementLegSnapshot,
  type SavingsMovementSnapshot,
  type SectorGoalSnapshot,
  TRANSACTION_TYPE_LABELS,
  type TransactionSnapshot,
  evaluateRevertEligibility,
} from "@/lib/domain/audit";
import {
  SAVINGS_MOVEMENT_TYPE_LABELS,
  type SavingsMovementTypeKey,
} from "@/lib/domain/savings";
import {
  ASSET_CLASS_LABELS,
  type AssetClassKey,
  type CurrencyCode,
  type PriceModeKey,
  type TransactionTypeKey,
  type VariableIncomeClassKey,
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

export type SavingsMovementWithInfo = SavingsMovement & {
  goal: { id: string; name: string };
  vehicle: { id: string; name: string };
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

export function toSectorGoalSnapshot(sg: SectorGoal): SectorGoalSnapshot {
  return {
    id: sg.id,
    assetClass: sg.assetClass as VariableIncomeClassKey,
    name: sg.name,
    targetPct: Number(sg.targetPct),
  };
}

export function toSavingsGoalSnapshot(goal: SavingsGoal): SavingsGoalSnapshot {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount !== null ? Number(goal.targetAmount) : null,
    targetDate: goal.targetDate
      ? goal.targetDate.toISOString().slice(0, 10)
      : null,
    isEmergencyReserve: goal.isEmergencyReserve,
    isClosed: goal.isClosed,
    sortOrder: goal.sortOrder,
  };
}

function toSavingsMovementLegSnapshot(
  m: SavingsMovementWithInfo
): SavingsMovementLegSnapshot {
  return {
    id: m.id,
    goalId: m.goalId,
    goalName: m.goal.name,
    vehicleId: m.vehicleId,
    vehicleName: m.vehicle.name,
    date: m.date.toISOString(),
    type: m.type as SavingsMovementTypeKey,
    signedAmount: Number(m.signedAmount),
    transferGroupId: m.transferGroupId ?? null,
    notes: m.notes ?? null,
  };
}

export function toSavingsMovementSnapshot(
  primary: SavingsMovementWithInfo,
  counterpart?: SavingsMovementWithInfo | null
): SavingsMovementSnapshot {
  return {
    ...toSavingsMovementLegSnapshot(primary),
    ...(counterpart
      ? { counterpart: toSavingsMovementLegSnapshot(counterpart) }
      : {}),
  };
}

export function buildSavingsMovementEntityLabel(
  snap: SavingsMovementSnapshot
): string {
  if (snap.counterpart) {
    return `${snap.goalName} → ${snap.counterpart.goalName} (Transferência)`;
  }
  return `${snap.goalName} (${SAVINGS_MOVEMENT_TYPE_LABELS[snap.type]})`;
}

export function buildSectorGoalEntityLabel(sg: {
  name: string;
  assetClass: VariableIncomeClassKey;
}): string {
  return `${sg.name} (${ASSET_CLASS_LABELS[sg.assetClass]})`;
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

    const txOrderByDate = [...transactions].sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;
      const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdDiff !== 0) return createdDiff;
      return a.id.localeCompare(b.id);
    });

    const earliestTxDate = txOrderByDate[0]?.date ?? null;
    const bootstrapBaseDate = earliestTxDate
      ? new Date(
          Date.UTC(
            earliestTxDate.getUTCFullYear(),
            earliestTxDate.getUTCMonth(),
            earliestTxDate.getUTCDate() - 1,
            12,
            0,
            0
          )
        )
      : null;

    if (goal) {
      const goalCreatedAt =
        bootstrapBaseDate && goal.updatedAt > earliestTxDate!
          ? bootstrapBaseDate
          : goal.updatedAt;
      rows.push({
        userId,
        entityType: "GOAL",
        entityId: goal.id,
        entityLabel: "Objetivos de Alocação",
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(toGoalSnapshot(goal)),
        createdAt: goalCreatedAt,
      });
    }

    let bootstrapAssetOffset = 1;
    for (const asset of assets) {
      const assetCreatedAt =
        bootstrapBaseDate && asset.createdAt > earliestTxDate!
          ? new Date(bootstrapBaseDate.getTime() + bootstrapAssetOffset++ * 1000)
          : asset.createdAt;
      rows.push({
        userId,
        entityType: "ASSET",
        entityId: asset.id,
        entityLabel: asset.ticker,
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(toAssetSnapshot(asset)),
        createdAt: assetCreatedAt,
      });
    }

    const dayCounts = new Map<string, number>();
    for (const t of txOrderByDate) {
      const snap = toTransactionSnapshot(t);
      const dayKey = t.date.toISOString().slice(0, 10);
      const offsetSeconds = dayCounts.get(dayKey) ?? 0;
      dayCounts.set(dayKey, offsetSeconds + 1);

      rows.push({
        userId,
        entityType: "TRANSACTION",
        entityId: t.id,
        entityLabel: buildTransactionEntityLabel(snap),
        action: "CREATE",
        beforeState: Prisma.DbNull,
        afterState: toJsonValue(snap),
        createdAt: new Date(t.date.getTime() + offsetSeconds * 1000),
      });
    }

    if (rows.length > 0) {
      await tx.auditEvent.createMany({ data: rows });
    }
  });
}

export interface ListAuditEventsParams {
  pillar?: AuditPillarFilter;
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
  const limit = Math.min(Math.max(params.limit ?? 30, 1), 100);
  const query = params.q?.trim();
  const pillar: AuditPillarFilter = params.pillar ?? "ALL";

  const allowedByPillar =
    pillar === "LONG_TERM"
      ? LONG_TERM_AUDIT_ENTITY_TYPES
      : pillar === "SAVINGS"
        ? SAVINGS_AUDIT_ENTITY_TYPES
        : null;

  let entityTypeFilter: Prisma.EnumAuditEntityTypeFilter<"AuditEvent"> | AuditEntityType | undefined;
  if (params.entityType && params.entityType !== "ALL") {
    if (allowedByPillar && !allowedByPillar.includes(params.entityType)) {
      return { events: [], nextCursor: null, totalCount: 0 };
    }
    entityTypeFilter = params.entityType;
  } else if (allowedByPillar) {
    entityTypeFilter = { in: allowedByPillar };
  }

  const hasFiltersOrCursor = Boolean(
    pillar !== "ALL" ||
      (params.entityType && params.entityType !== "ALL") ||
      (params.action && params.action !== "ALL") ||
      query ||
      params.cursor
  );

  const where: Prisma.AuditEventWhereInput = {
    userId,
    ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}),
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

  const fetchPage = () =>
    Promise.all([
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

  let [totalCount, rawEvents] = await fetchPage();

  if (totalCount === 0 && !hasFiltersOrCursor) {
    await ensureAuditBackfill(userId);
    [totalCount, rawEvents] = await fetchPage();
  }

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
    SECTOR_GOAL: new Set(),
    SAVINGS_GOAL: new Set(),
    SAVINGS_MOVEMENT: new Set(),
  };
  const relevantParentAssetIds = new Set<string>();
  const relevantTickers = new Set<string>();
  const relevantSavingsGoalIds = new Set<string>();
  const relevantSavingsVehicleIds = new Set<string>();

  for (const ev of pageEvents) {
    entityIdsByType[ev.entityType as AuditEntityTypeKey].add(ev.entityId);
    const before = parseSnapshot(ev.beforeState);
    if (ev.entityType === "TRANSACTION" && before) {
      relevantParentAssetIds.add((before as TransactionSnapshot).assetId);
    }
    if (ev.entityType === "ASSET" && before) {
      relevantTickers.add((before as AssetSnapshot).ticker);
    }
    if (ev.entityType === "SAVINGS_MOVEMENT" && before) {
      const m = before as SavingsMovementSnapshot;
      relevantSavingsGoalIds.add(m.goalId);
      relevantSavingsVehicleIds.add(m.vehicleId);
      if (m.counterpart) {
        relevantSavingsGoalIds.add(m.counterpart.goalId);
        relevantSavingsVehicleIds.add(m.counterpart.vehicleId);
      }
    }
  }

  const allEntityIds = [
    ...entityIdsByType.ASSET,
    ...entityIdsByType.TRANSACTION,
    ...entityIdsByType.GOAL,
    ...entityIdsByType.SECTOR_GOAL,
    ...entityIdsByType.SAVINGS_GOAL,
    ...entityIdsByType.SAVINGS_MOVEMENT,
  ];

  const [
    latestEventsForEntities,
    existingAssets,
    existingTransactions,
    existingGoal,
    assetTxRows,
    existingSectorGoals,
    sectorLinkedAssets,
    existingSavingsGoals,
    savingsGoalMovementRows,
    existingSavingsMovements,
    existingSavingsVehicles,
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
    entityIdsByType.SECTOR_GOAL.size > 0
      ? prisma.sectorGoal.findMany({
          where: { userId },
          select: { id: true, assetClass: true, name: true },
        })
      : Promise.resolve([]),
    entityIdsByType.SECTOR_GOAL.size > 0
      ? prisma.asset.findMany({
          where: { userId },
          select: { assetClass: true, sector: true },
        })
      : Promise.resolve([]),
    entityIdsByType.SAVINGS_GOAL.size > 0 || relevantSavingsGoalIds.size > 0
      ? prisma.savingsGoal.findMany({
          where: { userId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    entityIdsByType.SAVINGS_GOAL.size > 0
      ? prisma.savingsMovement.findMany({
          where: {
            userId,
            goalId: { in: [...entityIdsByType.SAVINGS_GOAL] },
          },
          select: { goalId: true },
          distinct: ["goalId"],
        })
      : Promise.resolve([]),
    entityIdsByType.SAVINGS_MOVEMENT.size > 0
      ? prisma.savingsMovement.findMany({
          where: {
            userId,
            id: { in: [...entityIdsByType.SAVINGS_MOVEMENT] },
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    relevantSavingsVehicleIds.size > 0
      ? prisma.savingsVehicle.findMany({
          where: {
            userId,
            id: { in: [...relevantSavingsVehicleIds] },
          },
          select: { id: true },
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

  const existingSectorGoalById = new Map(
    existingSectorGoals.map((sg) => [sg.id, sg])
  );
  const sectorKeyToGoalId = new Map(
    existingSectorGoals.map((sg) => [`${sg.assetClass}::${sg.name}`, sg.id])
  );
  const linkedAssetSectorKeys = new Set(
    sectorLinkedAssets.map((a) => `${a.assetClass}::${a.sector}`)
  );

  const existingSavingsGoalIdSet = new Set(existingSavingsGoals.map((g) => g.id));
  const savingsGoalNameToId = new Map(
    existingSavingsGoals.map((g) => [g.name, g.id])
  );
  const savingsGoalIdsWithMovements = new Set(
    savingsGoalMovementRows.map((r) => r.goalId)
  );
  const existingSavingsMovementIdSet = new Set(
    existingSavingsMovements.map((m) => m.id)
  );
  const existingSavingsVehicleIdSet = new Set(
    existingSavingsVehicles.map((v) => v.id)
  );

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
    let sectorNameConflictExists: boolean | undefined;
    let sectorHasLinkedAssets: boolean | undefined;
    let savingsGoalNameConflictExists: boolean | undefined;
    let savingsGoalHasMovements: boolean | undefined;
    let savingsParentsExist: boolean | undefined;

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
    } else if (entityType === "SECTOR_GOAL") {
      const currentSg = existingSectorGoalById.get(ev.entityId);
      currentEntityExists = Boolean(currentSg);
      if (currentSg) {
        sectorHasLinkedAssets = linkedAssetSectorKeys.has(
          `${currentSg.assetClass}::${currentSg.name}`
        );
      }
      if (beforeState) {
        const beforeSg = beforeState as SectorGoalSnapshot;
        const ownerId = sectorKeyToGoalId.get(
          `${beforeSg.assetClass}::${beforeSg.name}`
        );
        sectorNameConflictExists =
          ownerId !== undefined && ownerId !== ev.entityId;
      }
    } else if (entityType === "SAVINGS_GOAL") {
      currentEntityExists = existingSavingsGoalIdSet.has(ev.entityId);
      savingsGoalHasMovements = savingsGoalIdsWithMovements.has(ev.entityId);
      if (beforeState) {
        const beforeGoal = beforeState as SavingsGoalSnapshot;
        const ownerId = savingsGoalNameToId.get(beforeGoal.name);
        savingsGoalNameConflictExists =
          ownerId !== undefined && ownerId !== ev.entityId;
      }
    } else if (entityType === "SAVINGS_MOVEMENT") {
      currentEntityExists = existingSavingsMovementIdSet.has(ev.entityId);
      if (beforeState) {
        const beforeMov = beforeState as SavingsMovementSnapshot;
        const primaryOk =
          existingSavingsGoalIdSet.has(beforeMov.goalId) &&
          existingSavingsVehicleIdSet.has(beforeMov.vehicleId);
        const counterpartOk = beforeMov.counterpart
          ? existingSavingsGoalIdSet.has(beforeMov.counterpart.goalId) &&
            existingSavingsVehicleIdSet.has(beforeMov.counterpart.vehicleId)
          : true;
        savingsParentsExist = primaryOk && counterpartOk;
      }
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
      sectorNameConflictExists,
      sectorHasLinkedAssets,
      savingsGoalNameConflictExists,
      savingsGoalHasMovements,
      savingsParentsExist,
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
    let sectorNameConflictExists: boolean | undefined;
    let sectorHasLinkedAssets: boolean | undefined;
    let savingsGoalNameConflictExists: boolean | undefined;
    let savingsGoalHasMovements: boolean | undefined;
    let savingsParentsExist: boolean | undefined;

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
    } else if (entityType === "SECTOR_GOAL") {
      const currentSg = await tx.sectorGoal.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true, assetClass: true, name: true },
      });
      currentEntityExists = Boolean(currentSg);

      if (currentSg) {
        const linkedAsset = await tx.asset.findFirst({
          where: {
            userId,
            assetClass: currentSg.assetClass,
            sector: currentSg.name,
          },
          select: { id: true },
        });
        sectorHasLinkedAssets = Boolean(linkedAsset);
      }

      if (beforeState) {
        const beforeSg = beforeState as SectorGoalSnapshot;
        const conflict = await tx.sectorGoal.findFirst({
          where: {
            userId,
            assetClass: beforeSg.assetClass,
            name: beforeSg.name,
            id: { not: target.entityId },
          },
          select: { id: true },
        });
        sectorNameConflictExists = Boolean(conflict);
      }
    } else if (entityType === "SAVINGS_GOAL") {
      const currentSavingsGoal = await tx.savingsGoal.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true },
      });
      currentEntityExists = Boolean(currentSavingsGoal);

      if (currentSavingsGoal) {
        const linkedMov = await tx.savingsMovement.findFirst({
          where: { userId, goalId: target.entityId },
          select: { id: true },
        });
        savingsGoalHasMovements = Boolean(linkedMov);
      }

      if (beforeState) {
        const beforeGoal = beforeState as SavingsGoalSnapshot;
        const conflict = await tx.savingsGoal.findFirst({
          where: {
            userId,
            name: beforeGoal.name,
            id: { not: target.entityId },
          },
          select: { id: true },
        });
        savingsGoalNameConflictExists = Boolean(conflict);
      }
    } else if (entityType === "SAVINGS_MOVEMENT") {
      const currentMov = await tx.savingsMovement.findFirst({
        where: { id: target.entityId, userId },
        select: { id: true },
      });
      currentEntityExists = Boolean(currentMov);

      if (beforeState) {
        const beforeMov = beforeState as SavingsMovementSnapshot;
        const goalIds = [
          beforeMov.goalId,
          ...(beforeMov.counterpart ? [beforeMov.counterpart.goalId] : []),
        ];
        const vehicleIds = [
          beforeMov.vehicleId,
          ...(beforeMov.counterpart ? [beforeMov.counterpart.vehicleId] : []),
        ];
        const uniqueGoalIds = [...new Set(goalIds)];
        const uniqueVehicleIds = [...new Set(vehicleIds)];
        const [foundGoals, foundVehicles] = await Promise.all([
          tx.savingsGoal.findMany({
            where: { userId, id: { in: uniqueGoalIds } },
            select: { id: true },
          }),
          tx.savingsVehicle.findMany({
            where: { userId, id: { in: uniqueVehicleIds } },
            select: { id: true },
          }),
        ]);
        savingsParentsExist =
          foundGoals.length === uniqueGoalIds.length &&
          foundVehicles.length === uniqueVehicleIds.length;
      }
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
      sectorNameConflictExists,
      sectorHasLinkedAssets,
      savingsGoalNameConflictExists,
      savingsGoalHasMovements,
      savingsParentsExist,
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
    } else if (entityType === "SECTOR_GOAL") {
      const before = beforeState as SectorGoalSnapshot | null;
      const after = afterState as SectorGoalSnapshot | null;

      if (!before && after) {
        // Desfazer criação -> exclui objetivo de setor
        await tx.sectorGoal.delete({ where: { id: target.entityId } });
        nextLabel = buildSectorGoalEntityLabel(after);
      } else if (before && !after) {
        // Desfazer exclusão -> recria objetivo de setor
        await tx.sectorGoal.create({
          data: {
            id: before.id,
            userId,
            assetClass: before.assetClass,
            name: before.name,
            targetPct: before.targetPct,
          },
        });
        nextLabel = buildSectorGoalEntityLabel(before);
      } else if (before && after) {
        // Desfazer edição -> restaura nome/meta e renomeia ativos se nome mudou
        const currentSg = await tx.sectorGoal.findFirstOrThrow({
          where: { id: target.entityId, userId },
        });
        const updated = await tx.sectorGoal.update({
          where: { id: target.entityId },
          data: {
            name: before.name,
            targetPct: before.targetPct,
          },
        });
        if (currentSg.name !== before.name) {
          await tx.asset.updateMany({
            where: {
              userId,
              assetClass: currentSg.assetClass,
              sector: currentSg.name,
            },
            data: { sector: before.name },
          });
        }
        const snap = toSectorGoalSnapshot(updated);
        nextLabel = buildSectorGoalEntityLabel(snap);
        nextAfterState = snap;
      }
    } else if (entityType === "SAVINGS_GOAL") {
      const before = beforeState as SavingsGoalSnapshot | null;
      const after = afterState as SavingsGoalSnapshot | null;

      if (!before && after) {
        await tx.savingsGoal.delete({ where: { id: target.entityId } });
        nextLabel = after.name;
      } else if (before && !after) {
        if (before.isEmergencyReserve) {
          await tx.savingsGoal.updateMany({
            where: { userId, isEmergencyReserve: true },
            data: { isEmergencyReserve: false },
          });
        }
        await tx.savingsGoal.create({
          data: {
            id: before.id,
            userId,
            name: before.name,
            targetAmount: before.targetAmount,
            targetDate: before.targetDate
              ? new Date(`${before.targetDate.slice(0, 10)}T12:00:00.000Z`)
              : null,
            isEmergencyReserve: before.isEmergencyReserve,
            isClosed: before.isClosed,
            sortOrder: before.sortOrder,
          },
        });
        nextLabel = before.name;
      } else if (before && after) {
        if (before.isEmergencyReserve) {
          await tx.savingsGoal.updateMany({
            where: { userId, isEmergencyReserve: true, id: { not: target.entityId } },
            data: { isEmergencyReserve: false },
          });
        }
        const updated = await tx.savingsGoal.update({
          where: { id: target.entityId },
          data: {
            name: before.name,
            targetAmount: before.targetAmount,
            targetDate: before.targetDate
              ? new Date(`${before.targetDate.slice(0, 10)}T12:00:00.000Z`)
              : null,
            isEmergencyReserve: before.isEmergencyReserve,
            isClosed: before.isClosed,
            sortOrder: before.sortOrder,
          },
        });
        const snap = toSavingsGoalSnapshot(updated);
        nextLabel = snap.name;
        nextAfterState = snap;
      }
    } else if (entityType === "SAVINGS_MOVEMENT") {
      const before = beforeState as SavingsMovementSnapshot | null;
      const after = afterState as SavingsMovementSnapshot | null;

      if (!before && after) {
        // Undo creation/restoration -> delete movement (and counterpart if transfer)
        const idsToDelete = [
          after.id,
          ...(after.counterpart ? [after.counterpart.id] : []),
        ];
        await tx.monthlyAllocation.updateMany({
          where: { userId, linkedMovementId: { in: idsToDelete } },
          data: { linkedMovementId: null },
        });
        await tx.savingsMovement.deleteMany({
          where: { userId, id: { in: idsToDelete } },
        });
        nextLabel = buildSavingsMovementEntityLabel(after);
      } else if (before && !after) {
        // Undo deletion -> recreate movement (and counterpart if transfer)
        await tx.savingsMovement.create({
          data: {
            id: before.id,
            userId,
            goalId: before.goalId,
            vehicleId: before.vehicleId,
            date: new Date(before.date),
            type: before.type,
            signedAmount: before.signedAmount,
            transferGroupId: before.transferGroupId,
            notes: before.notes,
          },
        });
        if (before.counterpart) {
          await tx.savingsMovement.create({
            data: {
              id: before.counterpart.id,
              userId,
              goalId: before.counterpart.goalId,
              vehicleId: before.counterpart.vehicleId,
              date: new Date(before.counterpart.date),
              type: before.counterpart.type,
              signedAmount: before.counterpart.signedAmount,
              transferGroupId: before.counterpart.transferGroupId,
              notes: before.counterpart.notes,
            },
          });
        }
        nextLabel = buildSavingsMovementEntityLabel(before);
      } else if (before && after) {
        // Undo update -> restore fields (and counterpart if transfer)
        const updatedPrimary = await tx.savingsMovement.update({
          where: { id: target.entityId },
          data: {
            goalId: before.goalId,
            vehicleId: before.vehicleId,
            date: new Date(before.date),
            type: before.type,
            signedAmount: before.signedAmount,
            transferGroupId: before.transferGroupId,
            notes: before.notes,
          },
          include: {
            goal: { select: { id: true, name: true } },
            vehicle: { select: { id: true, name: true } },
          },
        });
        let updatedCounterpart: SavingsMovementWithInfo | null = null;
        if (before.counterpart) {
          updatedCounterpart = await tx.savingsMovement.update({
            where: { id: before.counterpart.id },
            data: {
              goalId: before.counterpart.goalId,
              vehicleId: before.counterpart.vehicleId,
              date: new Date(before.counterpart.date),
              type: before.counterpart.type,
              signedAmount: before.counterpart.signedAmount,
              transferGroupId: before.counterpart.transferGroupId,
              notes: before.counterpart.notes,
            },
            include: {
              goal: { select: { id: true, name: true } },
              vehicle: { select: { id: true, name: true } },
            },
          });
        }
        const snap = toSavingsMovementSnapshot(updatedPrimary, updatedCounterpart);
        nextLabel = buildSavingsMovementEntityLabel(snap);
        nextAfterState = snap;
      }
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
