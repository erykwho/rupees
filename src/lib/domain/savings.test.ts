import { describe, expect, it } from "vitest";
import {
  computeRemainingMonths,
  computeSavingsSummary,
  evaluateEmergencyReserveCalculator,
  parseReserveScenarios,
} from "./savings";

describe("savings domain engine", () => {
  it("computes remaining months matching the spreadsheet formula", () => {
    const ref = new Date("2026-11-26T12:00:00.000Z");
    expect(computeRemainingMonths("2028-07-01", ref)).toBe(19);
    expect(computeRemainingMonths("2027-04-30", ref)).toBe(5);
    expect(computeRemainingMonths("2025-01-01", ref)).toBe(0);
    expect(computeRemainingMonths(null, ref)).toBeNull();
  });

  it("evaluates emergency reserve calculator scenarios with MAX rule and safe defaults", () => {
    const calc = evaluateEmergencyReserveCalculator({
      monthlyExpenseBRL: 20000,
      scenarios: [
        { id: "s1", label: "Desemprego: 6 meses", mode: "MONTHS", months: 6 },
        { id: "s2", label: "Emergências médicas", mode: "FIXED", fixedAmount: 100000 },
      ],
    });
    expect(calc.scenarios[0].computedAmountBRL).toBe(120000);
    expect(calc.scenarios[1].computedAmountBRL).toBe(100000);
    expect(calc.recommendedTargetBRL).toBe(120000);

    // Corrupted JSON falls back cleanly without throwing
    expect(parseReserveScenarios("not-an-array")).toHaveLength(2);
    expect(parseReserveScenarios(null)).toHaveLength(2);
  });

  it("computes goal balances, missing amounts, monthly required, and custody matrix", () => {
    const ref = new Date("2026-11-26T12:00:00.000Z");
    const summary = computeSavingsSummary({
      referenceDate: ref,
      goals: [
        {
          id: "g-res",
          name: "Reserva de Emergência",
          targetAmount: 120000,
          targetDate: "2028-07-01",
          isEmergencyReserve: true,
          isClosed: false,
          sortOrder: 0,
        },
        {
          id: "g-trip",
          name: "Fundo próxima viagem",
          targetAmount: 20000,
          targetDate: "2027-04-30",
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 1,
        },
        {
          id: "g-reforma",
          name: "Fundo reforma",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 2,
        },
        {
          id: "g-old",
          name: "Viagem Chile",
          targetAmount: 10000,
          targetDate: "2025-09-01",
          isEmergencyReserve: false,
          isClosed: true,
          sortOrder: 3,
        },
      ],
      vehicles: [
        { id: "v-inter", name: "CDB Inter", institution: "Inter", isArchived: false },
        { id: "v-selic", name: "Tesouro Selic 2031", institution: "Tesouro Direto", isArchived: false },
      ],
      movements: [
        {
          id: "m1",
          goalId: "g-res",
          vehicleId: "v-inter",
          date: "2026-06-01T12:00:00.000Z",
          type: "DEPOSIT",
          signedAmount: 2000,
          transferGroupId: null,
          notes: null,
        },
        {
          id: "m2",
          goalId: "g-res",
          vehicleId: "v-selic",
          date: "2026-11-04T12:00:00.000Z",
          type: "DEPOSIT",
          signedAmount: 22000,
          transferGroupId: null,
          notes: null,
        },
        {
          id: "m3",
          goalId: "g-reforma",
          vehicleId: "v-selic",
          date: "2026-11-04T12:00:00.000Z",
          type: "DEPOSIT",
          signedAmount: 28524,
          transferGroupId: null,
          notes: null,
        },
        {
          id: "m4",
          goalId: "g-old",
          vehicleId: "v-selic",
          date: "2025-01-10T12:00:00.000Z",
          type: "DEPOSIT",
          signedAmount: 2000,
          transferGroupId: null,
          notes: null,
        },
        {
          id: "m5",
          goalId: "g-old",
          vehicleId: "v-selic",
          date: "2025-09-01T12:00:00.000Z",
          type: "WITHDRAWAL",
          signedAmount: -2000,
          transferGroupId: null,
          notes: null,
        },
      ],
    });

    expect(summary.activeGoals).toHaveLength(3);
    expect(summary.closedGoals).toHaveLength(1);
    expect(summary.emergencyReserveGoal?.id).toBe("g-res");
    expect(summary.emergencyReserveGoal?.currentBalanceBRL).toBe(24000);
    expect(summary.emergencyReserveGoal?.missingAmountBRL).toBe(96000);
    expect(summary.emergencyReserveGoal?.remainingMonths).toBe(19);
    expect(summary.emergencyReserveGoal?.requiredMonthlyBRL).toBe(5052.63);
    expect(summary.emergencyReserveGoal?.progressPct).toBe(20);
    expect(summary.emergencyReserveGoal?.lastVehicleId).toBe("v-selic");

    const trip = summary.activeGoals.find((g) => g.id === "g-trip")!;
    expect(trip.currentBalanceBRL).toBe(0);
    expect(trip.missingAmountBRL).toBe(20000);
    expect(trip.requiredMonthlyBRL).toBe(4000);

    const reforma = summary.activeGoals.find((g) => g.id === "g-reforma")!;
    expect(reforma.currentBalanceBRL).toBe(28524);
    expect(reforma.missingAmountBRL).toBeNull();
    expect(reforma.requiredMonthlyBRL).toBeNull();

    expect(summary.totalActiveBalanceBRL).toBe(52524);
    expect(summary.totalMissingBRL).toBe(116000);
    expect(summary.totalRequiredMonthlyBRL).toBe(9052.63);

    const selicVehicle = summary.vehicles.find((v) => v.id === "v-selic")!;
    expect(selicVehicle.totalBRL).toBe(50524);
    expect(selicVehicle.goalBreakdown).toHaveLength(2);
  });

  it("supports yield adjustments and atomic transfer pairs without altering total balance", () => {
    const summary = computeSavingsSummary({
      goals: [
        {
          id: "g1",
          name: "Fundo Gatos",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 0,
        },
        {
          id: "g2",
          name: "Fundo reforma",
          targetAmount: null,
          targetDate: null,
          isEmergencyReserve: false,
          isClosed: false,
          sortOrder: 1,
        },
      ],
      vehicles: [
        { id: "v1", name: "Tesouro Selic 2031", institution: null, isArchived: false },
      ],
      movements: [
        {
          id: "m1",
          goalId: "g1",
          vehicleId: "v1",
          date: "2026-09-01T12:00:00.000Z",
          type: "DEPOSIT",
          signedAmount: 800,
          transferGroupId: null,
          notes: null,
        },
        {
          id: "m2",
          goalId: "g1",
          vehicleId: "v1",
          date: "2026-10-01T12:00:00.000Z",
          type: "TRANSFER_OUT",
          signedAmount: -500,
          transferGroupId: "tr-1",
          notes: "Remanejamento",
        },
        {
          id: "m3",
          goalId: "g2",
          vehicleId: "v1",
          date: "2026-10-01T12:00:00.000Z",
          type: "TRANSFER_IN",
          signedAmount: 500,
          transferGroupId: "tr-1",
          notes: "Remanejamento",
        },
        {
          id: "m4",
          goalId: "g2",
          vehicleId: "v1",
          date: "2026-11-01T12:00:00.000Z",
          type: "YIELD_ADJUSTMENT",
          signedAmount: 12.34,
          transferGroupId: null,
          notes: "Rendimento Selic",
        },
      ],
    });

    expect(summary.goals.find((g) => g.id === "g1")?.currentBalanceBRL).toBe(300);
    expect(summary.goals.find((g) => g.id === "g2")?.currentBalanceBRL).toBe(512.34);
    expect(summary.totalActiveBalanceBRL).toBe(812.34);
  });
});
