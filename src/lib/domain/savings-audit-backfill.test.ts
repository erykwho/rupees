import { describe, expect, it } from "vitest";
import { planSavingsAuditBackfill } from "./savings-audit-backfill";

describe("planSavingsAuditBackfill", () => {
  it("plans historical CREATE events for goals and movements with deterministic chronological timestamps", () => {
    const plan = planSavingsAuditBackfill({
      goals: [
        {
          id: "g-res",
          name: "Reserva de Emergência",
          targetAmount: 120000,
          targetDate: new Date("2028-07-01T12:00:00.000Z"),
          isEmergencyReserve: true,
          isClosed: false,
          sortOrder: 0,
          createdAt: new Date("2026-11-26T22:00:00.000Z"),
        },
        {
          id: "g-empty",
          name: "Sem Movimentações",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 1,
          createdAt: new Date("2026-11-20T15:00:00.000Z"),
        },
      ],
      movements: [
        {
          id: "m-2",
          goalId: "g-res",
          goalName: "Reserva de Emergência",
          vehicleId: "v-selic",
          vehicleName: "Tesouro Selic 2031",
          date: new Date("2025-02-07T12:00:00.000Z"),
          type: "DEPOSIT",
          signedAmount: 500,
          transferGroupId: null,
          notes: null,
          externalKey: "sheet:investimentos-geral:row-12",
          createdAt: new Date("2026-11-26T22:00:00.000Z"),
        },
        {
          id: "m-1",
          goalId: "g-res",
          goalName: "Reserva de Emergência",
          vehicleId: "v-selic",
          vehicleName: "Tesouro Selic 2031",
          date: new Date("2025-02-07T12:00:00.000Z"),
          type: "DEPOSIT",
          signedAmount: 1000,
          transferGroupId: null,
          notes: null,
          externalKey: "sheet:investimentos-geral:row-5",
          createdAt: new Date("2026-11-26T22:00:00.000Z"),
        },
      ],
      existingGoalEventIds: new Set(),
      existingMovementEventIds: new Set(),
    });

    expect(plan.goalEvents).toHaveLength(2);
    expect(plan.goalEvents[0]).toMatchObject({
      entityType: "SAVINGS_GOAL",
      entityId: "g-res",
      entityLabel: "Reserva de Emergência",
      action: "CREATE",
      createdAt: new Date("2025-02-07T11:59:00.000Z"),
    });
    expect(plan.goalEvents[1]).toMatchObject({
      entityId: "g-empty",
      createdAt: new Date("2026-11-20T15:00:00.000Z"),
    });

    // Movements ordered by sheet row number (row-5 before row-12) with +1s offset on same day
    expect(plan.movementEvents).toHaveLength(2);
    expect(plan.movementEvents[0]).toMatchObject({
      entityType: "SAVINGS_MOVEMENT",
      entityId: "m-1",
      entityLabel: "Reserva de Emergência (Aporte)",
      createdAt: new Date("2025-02-07T12:00:00.000Z"),
    });
    expect(plan.movementEvents[1]).toMatchObject({
      entityId: "m-2",
      createdAt: new Date("2025-02-07T12:00:01.000Z"),
    });
  });

  it("groups paired transfers into a single event and skips already-audited entities idempotently", () => {
    const plan = planSavingsAuditBackfill({
      goals: [
        {
          id: "g-1",
          name: "Origem",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 0,
          createdAt: new Date("2026-01-01T12:00:00.000Z"),
        },
        {
          id: "g-2",
          name: "Destino",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 1,
          createdAt: new Date("2026-01-01T12:00:00.000Z"),
        },
      ],
      movements: [
        {
          id: "m-out",
          goalId: "g-1",
          goalName: "Origem",
          vehicleId: "v-1",
          vehicleName: "CDB",
          date: new Date("2026-03-10T12:00:00.000Z"),
          type: "TRANSFER_OUT",
          signedAmount: -300,
          transferGroupId: "tr-1",
          notes: "Troca",
          externalKey: null,
          createdAt: new Date("2026-03-10T12:00:00.000Z"),
        },
        {
          id: "m-in",
          goalId: "g-2",
          goalName: "Destino",
          vehicleId: "v-1",
          vehicleName: "CDB",
          date: new Date("2026-03-10T12:00:00.000Z"),
          type: "TRANSFER_IN",
          signedAmount: 300,
          transferGroupId: "tr-1",
          notes: "Troca",
          externalKey: null,
          createdAt: new Date("2026-03-10T12:00:00.000Z"),
        },
        {
          id: "m-existing",
          goalId: "g-1",
          goalName: "Origem",
          vehicleId: "v-1",
          vehicleName: "CDB",
          date: new Date("2026-03-12T12:00:00.000Z"),
          type: "DEPOSIT",
          signedAmount: 100,
          transferGroupId: null,
          notes: null,
          externalKey: null,
          createdAt: new Date("2026-03-12T12:00:00.000Z"),
        },
      ],
      existingGoalEventIds: new Set(["g-1"]),
      existingMovementEventIds: new Set(["m-existing"]),
    });

    expect(plan.skippedGoals).toBe(1);
    expect(plan.goalEvents).toHaveLength(1);
    expect(plan.goalEvents[0].entityId).toBe("g-2");

    expect(plan.skippedMovements).toBe(1);
    expect(plan.movementEvents).toHaveLength(1);
    expect(plan.movementEvents[0]).toMatchObject({
      entityId: "m-out",
      entityLabel: "Origem → Destino (Transferência)",
    });
    expect(plan.movementEvents[0].afterState).toMatchObject({
      id: "m-out",
      counterpart: { id: "m-in", goalName: "Destino", signedAmount: 300 },
    });
  });
});
