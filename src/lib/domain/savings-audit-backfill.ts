import type {
  SavingsGoalSnapshot,
  SavingsMovementLegSnapshot,
  SavingsMovementSnapshot,
} from "./audit";
import {
  SAVINGS_MOVEMENT_TYPE_LABELS,
  type SavingsMovementTypeKey,
} from "./savings";

export interface BackfillSavingsGoalInput {
  id: string;
  name: string;
  targetAmount: number | null;
  targetDate: Date | null;
  isEmergencyReserve: boolean;
  isClosed: boolean;
  sortOrder: number;
  createdAt: Date;
}

export interface BackfillSavingsMovementInput {
  id: string;
  goalId: string;
  goalName: string;
  vehicleId: string;
  vehicleName: string;
  date: Date;
  type: SavingsMovementTypeKey;
  signedAmount: number;
  transferGroupId: string | null;
  notes: string | null;
  externalKey: string | null;
  createdAt: Date;
}

export interface PlannedSavingsAuditEvent {
  entityType: "SAVINGS_GOAL" | "SAVINGS_MOVEMENT";
  entityId: string;
  entityLabel: string;
  action: "CREATE";
  beforeState: null;
  afterState: SavingsGoalSnapshot | SavingsMovementSnapshot;
  createdAt: Date;
}

export interface SavingsAuditBackfillPlan {
  goalEvents: PlannedSavingsAuditEvent[];
  movementEvents: PlannedSavingsAuditEvent[];
  skippedGoals: number;
  skippedMovements: number;
}

function extractSheetRowOrder(externalKey: string | null): number {
  if (!externalKey) return Number.MAX_SAFE_INTEGER;
  const match = /row-(\d+)$/.exec(externalKey);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function toGoalSnapshot(goal: BackfillSavingsGoalInput): SavingsGoalSnapshot {
  return {
    id: goal.id,
    name: goal.name,
    targetAmount: goal.targetAmount,
    targetDate: goal.targetDate
      ? goal.targetDate.toISOString().slice(0, 10)
      : null,
    isEmergencyReserve: goal.isEmergencyReserve,
    isClosed: goal.isClosed,
    sortOrder: goal.sortOrder,
  };
}

function toLegSnapshot(
  m: BackfillSavingsMovementInput
): SavingsMovementLegSnapshot {
  return {
    id: m.id,
    goalId: m.goalId,
    goalName: m.goalName,
    vehicleId: m.vehicleId,
    vehicleName: m.vehicleName,
    date: m.date.toISOString(),
    type: m.type,
    signedAmount: m.signedAmount,
    transferGroupId: m.transferGroupId,
    notes: m.notes,
  };
}

function buildMovementLabel(snap: SavingsMovementSnapshot): string {
  if (snap.counterpart) {
    return `${snap.goalName} → ${snap.counterpart.goalName} (Transferência)`;
  }
  return `${snap.goalName} (${SAVINGS_MOVEMENT_TYPE_LABELS[snap.type]})`;
}

/**
 * Plans idempotent historical CREATE AuditEvents for SavingsGoal and SavingsMovement records
 * that do not yet have a corresponding CREATE AuditEvent.
 *
 * - Each SavingsGoal CREATE event is placed at 11:59:00 UTC (+offsetSeconds) on the date
 *   of its earliest movement (right before that movement at 12:00:00 UTC), or at goal.createdAt
 *   when the goal has no movements.
 * - Each SavingsMovement CREATE event is placed at movement.date (+offsetSeconds per day)
 *   in deterministic sheet-row / creation order.
 * - Paired transfers sharing a transferGroupId emit a single SAVINGS_MOVEMENT event
 *   anchored on the TRANSFER_OUT leg with counterpart populated.
 */
export function planSavingsAuditBackfill(params: {
  goals: BackfillSavingsGoalInput[];
  movements: BackfillSavingsMovementInput[];
  existingGoalEventIds: ReadonlySet<string>;
  existingMovementEventIds: ReadonlySet<string>;
}): SavingsAuditBackfillPlan {
  const sortedMovements = [...params.movements].sort((a, b) => {
    const dateDiff = a.date.getTime() - b.date.getTime();
    if (dateDiff !== 0) return dateDiff;
    const rowDiff =
      extractSheetRowOrder(a.externalKey) - extractSheetRowOrder(b.externalKey);
    if (rowDiff !== 0) return rowDiff;
    const createdDiff = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  // Map each goal to its earliest movement date so goal CREATE sits just before its first movement
  const earliestMovDateByGoalId = new Map<string, Date>();
  for (const mov of sortedMovements) {
    if (!earliestMovDateByGoalId.has(mov.goalId)) {
      earliestMovDateByGoalId.set(mov.goalId, mov.date);
    }
  }

  const sortedGoals = [...params.goals].sort((a, b) => {
    const dateA = earliestMovDateByGoalId.get(a.id)?.getTime() ?? a.createdAt.getTime();
    const dateB = earliestMovDateByGoalId.get(b.id)?.getTime() ?? b.createdAt.getTime();
    if (dateA !== dateB) return dateA - dateB;
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });

  const goalEvents: PlannedSavingsAuditEvent[] = [];
  let skippedGoals = 0;
  const goalDayCounts = new Map<string, number>();

  for (const goal of sortedGoals) {
    if (params.existingGoalEventIds.has(goal.id)) {
      skippedGoals++;
      continue;
    }

    const earliestDate = earliestMovDateByGoalId.get(goal.id);
    let createdAt: Date;
    if (earliestDate) {
      const dayKey = earliestDate.toISOString().slice(0, 10);
      const offsetSeconds = goalDayCounts.get(dayKey) ?? 0;
      goalDayCounts.set(dayKey, offsetSeconds + 1);
      createdAt = new Date(
        Date.UTC(
          earliestDate.getUTCFullYear(),
          earliestDate.getUTCMonth(),
          earliestDate.getUTCDate(),
          11,
          59,
          offsetSeconds
        )
      );
    } else {
      createdAt = goal.createdAt;
    }

    goalEvents.push({
      entityType: "SAVINGS_GOAL",
      entityId: goal.id,
      entityLabel: goal.name,
      action: "CREATE",
      beforeState: null,
      afterState: toGoalSnapshot(goal),
      createdAt,
    });
  }

  // Group paired transfers (TRANSFER_OUT + TRANSFER_IN sharing transferGroupId)
  const transfersByGroup = new Map<string, BackfillSavingsMovementInput[]>();
  for (const mov of sortedMovements) {
    if (mov.transferGroupId) {
      const list = transfersByGroup.get(mov.transferGroupId) ?? [];
      list.push(mov);
      transfersByGroup.set(mov.transferGroupId, list);
    }
  }

  const movementEvents: PlannedSavingsAuditEvent[] = [];
  let skippedMovements = 0;
  const consumedTransferGroups = new Set<string>();
  const movDayCounts = new Map<string, number>();

  for (const mov of sortedMovements) {
    if (mov.transferGroupId) {
      if (consumedTransferGroups.has(mov.transferGroupId)) continue;
      consumedTransferGroups.add(mov.transferGroupId);

      const legs = transfersByGroup.get(mov.transferGroupId) ?? [mov];
      const outLeg = legs.find((l) => l.type === "TRANSFER_OUT") ?? legs[0];
      const inLeg = legs.find((l) => l.id !== outLeg.id) ?? null;

      if (
        params.existingMovementEventIds.has(outLeg.id) ||
        (inLeg && params.existingMovementEventIds.has(inLeg.id))
      ) {
        skippedMovements++;
        continue;
      }

      const dayKey = outLeg.date.toISOString().slice(0, 10);
      const offsetSeconds = movDayCounts.get(dayKey) ?? 0;
      movDayCounts.set(dayKey, offsetSeconds + 1);

      const snap: SavingsMovementSnapshot = {
        ...toLegSnapshot(outLeg),
        ...(inLeg ? { counterpart: toLegSnapshot(inLeg) } : {}),
      };

      movementEvents.push({
        entityType: "SAVINGS_MOVEMENT",
        entityId: outLeg.id,
        entityLabel: buildMovementLabel(snap),
        action: "CREATE",
        beforeState: null,
        afterState: snap,
        createdAt: new Date(outLeg.date.getTime() + offsetSeconds * 1000),
      });
      continue;
    }

    if (params.existingMovementEventIds.has(mov.id)) {
      skippedMovements++;
      continue;
    }

    const dayKey = mov.date.toISOString().slice(0, 10);
    const offsetSeconds = movDayCounts.get(dayKey) ?? 0;
    movDayCounts.set(dayKey, offsetSeconds + 1);

    const snap: SavingsMovementSnapshot = toLegSnapshot(mov);

    movementEvents.push({
      entityType: "SAVINGS_MOVEMENT",
      entityId: mov.id,
      entityLabel: buildMovementLabel(snap),
      action: "CREATE",
      beforeState: null,
      afterState: snap,
      createdAt: new Date(mov.date.getTime() + offsetSeconds * 1000),
    });
  }

  return {
    goalEvents,
    movementEvents,
    skippedGoals,
    skippedMovements,
  };
}
