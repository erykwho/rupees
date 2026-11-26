export type SavingsMovementTypeKey =
  | "DEPOSIT"
  | "WITHDRAWAL"
  | "TRANSFER_OUT"
  | "TRANSFER_IN"
  | "YIELD_ADJUSTMENT";

export const SAVINGS_MOVEMENT_TYPE_LABELS: Record<
  SavingsMovementTypeKey,
  string
> = {
  DEPOSIT: "Aporte",
  WITHDRAWAL: "Resgate",
  TRANSFER_OUT: "Transf. (saída)",
  TRANSFER_IN: "Transf. (entrada)",
  YIELD_ADJUSTMENT: "Rendimento",
};

export type EmergencyReserveScenarioMode = "MONTHS" | "FIXED";

export interface EmergencyReserveScenario {
  id: string;
  label: string;
  mode: EmergencyReserveScenarioMode;
  months?: number | null;
  fixedAmount?: number | null;
}

export interface EvaluatedEmergencyReserveScenario
  extends EmergencyReserveScenario {
  computedAmountBRL: number;
}

export interface EmergencyReserveCalculatorSummary {
  monthlyExpenseBRL: number;
  scenarios: EvaluatedEmergencyReserveScenario[];
  recommendedTargetBRL: number;
}

export interface SavingsGoalInput {
  id: string;
  name: string;
  targetAmount: number | null;
  targetDate: string | null; // ISO "YYYY-MM-DD" or full ISO string
  isEmergencyReserve: boolean;
  isClosed: boolean;
  sortOrder: number;
}

export interface SavingsVehicleInput {
  id: string;
  name: string;
  institution: string | null;
  isArchived: boolean;
}

export interface SavingsMovementInput {
  id: string;
  goalId: string;
  vehicleId: string;
  date: string; // ISO date string
  type: SavingsMovementTypeKey;
  signedAmount: number;
  transferGroupId: string | null;
  notes: string | null;
}

export interface SavingsGoalSummary extends SavingsGoalInput {
  currentBalanceBRL: number;
  remainingMonths: number | null;
  missingAmountBRL: number | null;
  requiredMonthlyBRL: number | null;
  progressPct: number | null;
  movementCount: number;
  lastVehicleId: string | null;
  lastVehicleName: string | null;
}

export interface SavingsMovementDTO extends SavingsMovementInput {
  goalName: string;
  vehicleName: string;
}

export interface SavingsVehicleBreakdownItem {
  goalId: string;
  goalName: string;
  isClosed: boolean;
  isEmergencyReserve: boolean;
  balanceBRL: number;
}

export interface SavingsVehicleSummary extends SavingsVehicleInput {
  totalBRL: number;
  goalBreakdown: SavingsVehicleBreakdownItem[];
}

export interface SavingsMatrixRow {
  goalId: string;
  goalName: string;
  isClosed: boolean;
  isEmergencyReserve: boolean;
  byVehicle: Record<string, number>;
  totalBRL: number;
}

export interface SavingsSummary {
  goals: SavingsGoalSummary[];
  activeGoals: SavingsGoalSummary[];
  closedGoals: SavingsGoalSummary[];
  vehicles: SavingsVehicleSummary[];
  movements: SavingsMovementDTO[];
  matrixRows: SavingsMatrixRow[];
  totalActiveBalanceBRL: number;
  totalAllBalanceBRL: number;
  totalMissingBRL: number;
  totalRequiredMonthlyBRL: number;
  emergencyReserveGoal: SavingsGoalSummary | null;
  reserveCalculator: EmergencyReserveCalculatorSummary;
}

export const DEFAULT_EMERGENCY_RESERVE_SCENARIOS: EmergencyReserveScenario[] = [
  {
    id: "unemployment",
    label: "Desemprego (6 meses sem renda)",
    mode: "MONTHS",
    months: 6,
    fixedAmount: null,
  },
  {
    id: "medical",
    label: "Emergências médicas",
    mode: "FIXED",
    months: null,
    fixedAmount: 0,
  },
];

export function roundMoney(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Computes whole calendar months remaining from referenceDate to targetDate (UTC date parts).
 * Mirrors ROUNDDOWN(DAYS360(TODAY(), targetDate) / 30, 0) floored at 0.
 */
export function computeRemainingMonths(
  targetDateIso: string | null | undefined,
  referenceDate: Date = new Date()
): number | null {
  if (!targetDateIso) return null;
  const datePart = targetDateIso.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;

  const targetYear = Number(match[1]);
  const targetMonth = Number(match[2]);
  const targetDay = Number(match[3]);

  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth() + 1;
  const refDay = referenceDate.getUTCDate();

  let months = (targetYear - refYear) * 12 + (targetMonth - refMonth);
  if (targetDay < refDay) {
    months -= 1;
  }
  return Math.max(0, months);
}

export function parseReserveScenarios(
  raw: unknown
): EmergencyReserveScenario[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_EMERGENCY_RESERVE_SCENARIOS.map((s) => ({ ...s }));
  }

  const parsed: EmergencyReserveScenario[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const label =
      typeof obj.label === "string" && obj.label.trim().length > 0
        ? obj.label.trim()
        : `Cenário ${i + 1}`;
    const mode: EmergencyReserveScenarioMode =
      obj.mode === "MONTHS" ? "MONTHS" : "FIXED";
    const id =
      typeof obj.id === "string" && obj.id.trim().length > 0
        ? obj.id.trim()
        : `scenario-${i + 1}`;
    const months =
      mode === "MONTHS" &&
      typeof obj.months === "number" &&
      Number.isFinite(obj.months) &&
      obj.months >= 0
        ? obj.months
        : null;
    const fixedAmount =
      mode === "FIXED" &&
      typeof obj.fixedAmount === "number" &&
      Number.isFinite(obj.fixedAmount) &&
      obj.fixedAmount >= 0
        ? roundMoney(obj.fixedAmount)
        : null;

    parsed.push({
      id,
      label,
      mode,
      months: mode === "MONTHS" ? (months ?? 0) : null,
      fixedAmount: mode === "FIXED" ? (fixedAmount ?? 0) : null,
    });
  }

  return parsed.length > 0
    ? parsed
    : DEFAULT_EMERGENCY_RESERVE_SCENARIOS.map((s) => ({ ...s }));
}

export function evaluateEmergencyReserveCalculator(input?: {
  monthlyExpenseBRL?: number | null;
  scenarios?: unknown;
}): EmergencyReserveCalculatorSummary {
  const monthlyExpenseBRL =
    typeof input?.monthlyExpenseBRL === "number" &&
    Number.isFinite(input.monthlyExpenseBRL) &&
    input.monthlyExpenseBRL > 0
      ? roundMoney(input.monthlyExpenseBRL)
      : 0;

  const baseScenarios = parseReserveScenarios(input?.scenarios);
  const scenarios: EvaluatedEmergencyReserveScenario[] = baseScenarios.map(
    (scenario) => {
      const computedAmountBRL =
        scenario.mode === "MONTHS"
          ? roundMoney(monthlyExpenseBRL * Math.max(0, scenario.months ?? 0))
          : roundMoney(Math.max(0, scenario.fixedAmount ?? 0));

      return {
        ...scenario,
        computedAmountBRL,
      };
    }
  );

  const recommendedTargetBRL = scenarios.reduce(
    (max, item) => Math.max(max, item.computedAmountBRL),
    0
  );

  return {
    monthlyExpenseBRL,
    scenarios,
    recommendedTargetBRL: roundMoney(recommendedTargetBRL),
  };
}

export function computeSavingsSummary(input: {
  goals: SavingsGoalInput[];
  vehicles: SavingsVehicleInput[];
  movements: SavingsMovementInput[];
  reserveConfig?: {
    monthlyExpenseBRL?: number | null;
    scenarios?: unknown;
  } | null;
  referenceDate?: Date;
}): SavingsSummary {
  const referenceDate = input.referenceDate ?? new Date();
  const goalMap = new Map(input.goals.map((g) => [g.id, g]));
  const vehicleMap = new Map(input.vehicles.map((v) => [v.id, v]));

  // Sort movements newest-first for ledger display and last-used vehicle lookup
  const sortedMovements = [...input.movements].sort((a, b) => {
    const dateDiff =
      new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return b.id.localeCompare(a.id);
  });

  const balanceByGoal = new Map<string, number>();
  const countByGoal = new Map<string, number>();
  const lastVehicleByGoal = new Map<string, string>();
  const balanceByGoalAndVehicle = new Map<string, Map<string, number>>();
  const balanceByVehicle = new Map<string, number>();

  for (const m of sortedMovements) {
    balanceByGoal.set(
      m.goalId,
      roundMoney((balanceByGoal.get(m.goalId) ?? 0) + m.signedAmount)
    );
    countByGoal.set(m.goalId, (countByGoal.get(m.goalId) ?? 0) + 1);
    if (!lastVehicleByGoal.has(m.goalId)) {
      lastVehicleByGoal.set(m.goalId, m.vehicleId);
    }

    balanceByVehicle.set(
      m.vehicleId,
      roundMoney((balanceByVehicle.get(m.vehicleId) ?? 0) + m.signedAmount)
    );

    let perVehicle = balanceByGoalAndVehicle.get(m.goalId);
    if (!perVehicle) {
      perVehicle = new Map<string, number>();
      balanceByGoalAndVehicle.set(m.goalId, perVehicle);
    }
    perVehicle.set(
      m.vehicleId,
      roundMoney((perVehicle.get(m.vehicleId) ?? 0) + m.signedAmount)
    );
  }

  const orderedGoals = [...input.goals].sort((a, b) => {
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    if (a.isEmergencyReserve !== b.isEmergencyReserve) {
      return a.isEmergencyReserve ? -1 : 1;
    }
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const goals: SavingsGoalSummary[] = orderedGoals.map((goal) => {
    const currentBalanceBRL = roundMoney(balanceByGoal.get(goal.id) ?? 0);
    const remainingMonths = computeRemainingMonths(
      goal.targetDate,
      referenceDate
    );

    const hasTarget =
      goal.targetAmount !== null &&
      Number.isFinite(goal.targetAmount) &&
      goal.targetAmount > 0;

    const missingAmountBRL = hasTarget
      ? roundMoney(Math.max(0, (goal.targetAmount as number) - currentBalanceBRL))
      : null;

    let requiredMonthlyBRL: number | null = null;
    if (missingAmountBRL !== null) {
      if (missingAmountBRL <= 0) {
        requiredMonthlyBRL = 0;
      } else if (remainingMonths !== null && remainingMonths > 0) {
        requiredMonthlyBRL = roundMoney(missingAmountBRL / remainingMonths);
      } else if (remainingMonths === 0 || goal.targetDate !== null) {
        requiredMonthlyBRL = missingAmountBRL;
      }
    }

    const progressPct = hasTarget
      ? Math.min(
          100,
          Math.max(
            0,
            roundMoney((currentBalanceBRL / (goal.targetAmount as number)) * 100)
          )
        )
      : null;

    const lastVehicleId = lastVehicleByGoal.get(goal.id) ?? null;
    const lastVehicleName = lastVehicleId
      ? (vehicleMap.get(lastVehicleId)?.name ?? null)
      : null;

    return {
      ...goal,
      currentBalanceBRL,
      remainingMonths,
      missingAmountBRL,
      requiredMonthlyBRL,
      progressPct,
      movementCount: countByGoal.get(goal.id) ?? 0,
      lastVehicleId,
      lastVehicleName,
    };
  });

  const activeGoals = goals.filter((g) => !g.isClosed);
  const closedGoals = goals.filter((g) => g.isClosed);

  const orderedVehicles = [...input.vehicles].sort((a, b) => {
    if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  const vehicles: SavingsVehicleSummary[] = orderedVehicles.map((vehicle) => {
    const totalBRL = roundMoney(balanceByVehicle.get(vehicle.id) ?? 0);
    const goalBreakdown: SavingsVehicleBreakdownItem[] = [];

    for (const goal of goals) {
      const cellValue = roundMoney(
        balanceByGoalAndVehicle.get(goal.id)?.get(vehicle.id) ?? 0
      );
      if (Math.abs(cellValue) >= 0.005) {
        goalBreakdown.push({
          goalId: goal.id,
          goalName: goal.name,
          isClosed: goal.isClosed,
          isEmergencyReserve: goal.isEmergencyReserve,
          balanceBRL: cellValue,
        });
      }
    }

    return {
      ...vehicle,
      totalBRL,
      goalBreakdown,
    };
  });

  const matrixRows: SavingsMatrixRow[] = goals.map((goal) => {
    const perVehicle = balanceByGoalAndVehicle.get(goal.id);
    const byVehicle: Record<string, number> = {};
    for (const vehicle of orderedVehicles) {
      const value = roundMoney(perVehicle?.get(vehicle.id) ?? 0);
      if (Math.abs(value) >= 0.005) {
        byVehicle[vehicle.id] = value;
      }
    }
    return {
      goalId: goal.id,
      goalName: goal.name,
      isClosed: goal.isClosed,
      isEmergencyReserve: goal.isEmergencyReserve,
      byVehicle,
      totalBRL: goal.currentBalanceBRL,
    };
  });

  const movements: SavingsMovementDTO[] = sortedMovements.map((m) => ({
    ...m,
    signedAmount: roundMoney(m.signedAmount),
    goalName: goalMap.get(m.goalId)?.name ?? "Caixinha removida",
    vehicleName: vehicleMap.get(m.vehicleId)?.name ?? "Produto removido",
  }));

  const totalActiveBalanceBRL = roundMoney(
    activeGoals.reduce((sum, g) => sum + g.currentBalanceBRL, 0)
  );
  const totalAllBalanceBRL = roundMoney(
    goals.reduce((sum, g) => sum + g.currentBalanceBRL, 0)
  );
  const totalMissingBRL = roundMoney(
    activeGoals.reduce((sum, g) => sum + (g.missingAmountBRL ?? 0), 0)
  );
  const totalRequiredMonthlyBRL = roundMoney(
    activeGoals.reduce((sum, g) => sum + (g.requiredMonthlyBRL ?? 0), 0)
  );

  const emergencyReserveGoal =
    activeGoals.find((g) => g.isEmergencyReserve) ??
    goals.find((g) => g.isEmergencyReserve) ??
    null;

  const reserveCalculator = evaluateEmergencyReserveCalculator(
    input.reserveConfig ?? undefined
  );

  return {
    goals,
    activeGoals,
    closedGoals,
    vehicles,
    movements,
    matrixRows,
    totalActiveBalanceBRL,
    totalAllBalanceBRL,
    totalMissingBRL,
    totalRequiredMonthlyBRL,
    emergencyReserveGoal,
    reserveCalculator,
  };
}
