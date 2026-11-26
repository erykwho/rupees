import { prisma } from "@/lib/prisma";
import {
  computeSavingsSummary,
  type SavingsMovementTypeKey,
  type SavingsSummary,
} from "@/lib/domain/savings";
import {
  DEFAULT_USER_CACHE_TTL_SECONDS,
  runCachedForUser,
  userSavingsTag,
} from "@/lib/server-cache";

export async function loadUserSavingsSummary(
  userId: string
): Promise<SavingsSummary> {
  const [goals, vehicles, movements, reserveConfig] = await Promise.all([
    prisma.savingsGoal.findMany({
      where: { userId },
      orderBy: [{ isClosed: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.savingsVehicle.findMany({
      where: { userId },
      orderBy: [{ isArchived: "asc" }, { name: "asc" }],
    }),
    prisma.savingsMovement.findMany({
      where: { userId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    prisma.emergencyReserveConfig.findUnique({
      where: { userId },
    }),
  ]);

  return computeSavingsSummary({
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetAmount: g.targetAmount !== null ? Number(g.targetAmount) : null,
      targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null,
      isEmergencyReserve: g.isEmergencyReserve,
      isClosed: g.isClosed,
      sortOrder: g.sortOrder,
    })),
    vehicles: vehicles.map((v) => ({
      id: v.id,
      name: v.name,
      institution: v.institution,
      isArchived: v.isArchived,
    })),
    movements: movements.map((m) => ({
      id: m.id,
      goalId: m.goalId,
      vehicleId: m.vehicleId,
      date: m.date.toISOString(),
      type: m.type as SavingsMovementTypeKey,
      signedAmount: Number(m.signedAmount),
      transferGroupId: m.transferGroupId,
      notes: m.notes,
    })),
    reserveConfig: reserveConfig
      ? {
          monthlyExpenseBRL: Number(reserveConfig.monthlyExpense),
          scenarios: reserveConfig.scenariosJson,
        }
      : null,
  });
}

export async function loadCachedUserSavingsSummary(
  userId: string
): Promise<SavingsSummary> {
  return runCachedForUser({
    keyPrefix: "user-savings-v1",
    userId,
    tags: [userSavingsTag(userId)],
    revalidateSeconds: DEFAULT_USER_CACHE_TTL_SECONDS,
    loader: () => loadUserSavingsSummary(userId),
  });
}
