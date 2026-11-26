/**
 * Idempotent importer for the "Situação financeira" Google Sheet tabs:
 *  - "Investimentos - Geral" (SavingsGoal, SavingsVehicle, SavingsMovement, EmergencyReserveConfig)
 *  - Monthly tab e.g. "Novembro/2026" (MonthlyBudget, MonthlyIncome, MonthlyExpense, MonthlyAllocation)
 *
 * Defaults to --dry-run. Pass --apply to write to the database.
 *
 * Usage:
 *   pnpm db:import:sheet --email user@example.com --savings-csv /tmp/inv.csv --month-csv /tmp/nov2026.csv --year 2026 --month 11
 *   pnpm db:import:sheet --email user@example.com --savings-csv /tmp/inv.csv --month-csv /tmp/nov2026.csv --year 2026 --month 11 --apply
 */

import fs from "node:fs";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  parseInvestimentosGeralCsv,
  parseMonthlyBudgetCsv,
} from "../src/lib/domain/financial-sheet-import";
import { computeMonthlyBudgetSummary } from "../src/lib/domain/monthly-budget";

const prisma = new PrismaClient();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function normalizeKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function main() {
  const email = getArg("--email")?.trim().toLowerCase();
  const savingsCsvPath = getArg("--savings-csv");
  const monthCsvPath = getArg("--month-csv");
  const year = Number(getArg("--year") ?? "2026");
  const month = Number(getArg("--month") ?? "11");
  const apply = hasFlag("--apply");
  const replaceMonth = hasFlag("--replace-month");

  if (!email) {
    console.error("Missing required --email argument.");
    process.exit(1);
  }
  if (!savingsCsvPath && !monthCsvPath) {
    console.error("Provide at least one of --savings-csv or --month-csv.");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found for email: ${email}`);
    process.exit(1);
  }

  console.log(
    `Mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no changes will be written)"}`
  );
  console.log(`Target user: ${user.email} (${user.id})`);

  const goalIdByNormName = new Map<string, string>();
  const existingGoals = await prisma.savingsGoal.findMany({
    where: { userId: user.id },
  });
  for (const g of existingGoals) {
    goalIdByNormName.set(normalizeKey(g.name), g.id);
  }

  // --- 1. Investimentos - Geral ---
  if (savingsCsvPath) {
    const resolved = path.resolve(savingsCsvPath);
    const csvText = fs.readFileSync(resolved, "utf-8");
    const parsed = parseInvestimentosGeralCsv(csvText);

    const existingVehicles = await prisma.savingsVehicle.findMany({
      where: { userId: user.id },
    });
    const vehicleIdByNormName = new Map(
      existingVehicles.map((v) => [normalizeKey(v.name), v.id])
    );

    const existingMovKeys = new Set(
      (
        await prisma.savingsMovement.findMany({
          where: { userId: user.id, externalKey: { not: null } },
          select: { externalKey: true },
        })
      )
        .map((m) => m.externalKey)
        .filter((k): k is string => Boolean(k))
    );

    const goalsToCreate = parsed.goals.filter(
      (g) => !goalIdByNormName.has(normalizeKey(g.name))
    );
    const vehiclesToCreate = parsed.vehicles.filter(
      (v) => !vehicleIdByNormName.has(normalizeKey(v))
    );
    const movementsToCreate = parsed.movements.filter(
      (m) => !existingMovKeys.has(m.externalKey)
    );

    console.log("\n[Investimentos - Geral]");
    console.log(
      `  Goals parsed: ${parsed.goals.length} (to create: ${goalsToCreate.length})`
    );
    console.log(
      `  Vehicles parsed: ${parsed.vehicles.length} (to create: ${vehiclesToCreate.length})`
    );
    console.log(
      `  Movements parsed: ${parsed.movements.length} (to create: ${movementsToCreate.length})`
    );
    console.log(
      `  Reserve calculator config: ${parsed.reserveCalculator ? `R$ ${parsed.reserveCalculator.monthlyExpenseBRL}/month (${parsed.reserveCalculator.scenarios.length} scenarios)` : "none"}`
    );

    if (apply) {
      await prisma.$transaction(async (tx) => {
        for (const g of parsed.goals) {
          const norm = normalizeKey(g.name);
          const existingId = goalIdByNormName.get(norm);
          if (existingId) {
            await tx.savingsGoal.update({
              where: { id: existingId },
              data: {
                targetAmount: g.targetAmount,
                targetDate: g.targetDate
                  ? new Date(`${g.targetDate}T12:00:00.000Z`)
                  : null,
                isEmergencyReserve: g.isEmergencyReserve,
                isClosed: g.isClosed,
                sortOrder: g.sortOrder,
              },
            });
          } else {
            const created = await tx.savingsGoal.create({
              data: {
                userId: user.id,
                name: g.name,
                targetAmount: g.targetAmount,
                targetDate: g.targetDate
                  ? new Date(`${g.targetDate}T12:00:00.000Z`)
                  : null,
                isEmergencyReserve: g.isEmergencyReserve,
                isClosed: g.isClosed,
                sortOrder: g.sortOrder,
              },
            });
            goalIdByNormName.set(norm, created.id);
          }
        }

        for (const vName of parsed.vehicles) {
          const norm = normalizeKey(vName);
          if (!vehicleIdByNormName.has(norm)) {
            const created = await tx.savingsVehicle.create({
              data: {
                userId: user.id,
                name: vName,
              },
            });
            vehicleIdByNormName.set(norm, created.id);
          }
        }

        for (const m of movementsToCreate) {
          const goalId = goalIdByNormName.get(normalizeKey(m.goalName));
          const vehicleId = vehicleIdByNormName.get(normalizeKey(m.vehicleName));
          if (!goalId || !vehicleId) continue;

          await tx.savingsMovement.create({
            data: {
              userId: user.id,
              goalId,
              vehicleId,
              date: new Date(`${m.date}T12:00:00.000Z`),
              type: m.type,
              signedAmount: m.signedAmount,
              externalKey: m.externalKey,
            },
          });
        }

        if (parsed.reserveCalculator) {
          await tx.emergencyReserveConfig.upsert({
            where: { userId: user.id },
            create: {
              userId: user.id,
              monthlyExpense: parsed.reserveCalculator.monthlyExpenseBRL,
              scenariosJson: parsed.reserveCalculator
                .scenarios as unknown as Prisma.InputJsonValue,
            },
            update: {
              monthlyExpense: parsed.reserveCalculator.monthlyExpenseBRL,
              scenariosJson: parsed.reserveCalculator
                .scenarios as unknown as Prisma.InputJsonValue,
            },
          });
        }
      });

      console.log("  Applied Investimentos - Geral successfully.");
    }
  }

  // --- 2. Monthly tab ---
  if (monthCsvPath) {
    const resolved = path.resolve(monthCsvPath);
    const csvText = fs.readFileSync(resolved, "utf-8");
    const parsed = parseMonthlyBudgetCsv(csvText, year, month);

    const preview = computeMonthlyBudgetSummary({
      id: "preview",
      year: parsed.year,
      month: parsed.month,
      checkingBalance: parsed.checkingBalance,
      reportDate: `${parsed.reportDate}T12:00:00.000Z`,
      notes: null,
      incomes: parsed.incomes.map((i, idx) => ({ id: `i-${idx}`, ...i })),
      expenses: parsed.expenses.map((e, idx) => ({ id: `e-${idx}`, ...e })),
      allocations: parsed.allocations.map((a, idx) => ({
        id: `a-${idx}`,
        kind: a.kind,
        name: a.name,
        savingsGoalId: a.goalName
          ? (goalIdByNormName.get(normalizeKey(a.goalName)) ?? null)
          : null,
        amount: a.amount,
        isExecuted: a.isExecuted,
        linkedMovementId: null,
        isRecurring: a.isRecurring,
        sortOrder: a.sortOrder,
      })),
    });

    const existingBudget = await prisma.monthlyBudget.findUnique({
      where: { userId_year_month: { userId: user.id, year, month } },
      select: { id: true },
    });

    console.log(`\n[Monthly Budget ${year}-${String(month).padStart(2, "0")}]`);
    console.log(`  Existing in DB: ${existingBudget ? "YES" : "NO"}`);
    console.log(
      `  Report date: ${parsed.reportDate} | Checking: R$ ${parsed.checkingBalance.toFixed(2)}`
    );
    console.log(
      `  Incomes: ${parsed.incomes.length} (Total R$ ${preview.totals.totalIncomeBRL.toFixed(2)}, Net R$ ${preview.totals.netIncomeBRL.toFixed(2)})`
    );
    console.log(
      `  Expenses: ${parsed.expenses.length} (Pending R$ ${preview.totals.pendingExpensesBRL.toFixed(2)})`
    );
    console.log(
      `  Allocations: ${parsed.allocations.length} (Real Cash R$ ${preview.totals.realAvailableCashBRL.toFixed(2)}, Surplus R$ ${preview.totals.surplusBeforeInvestmentsBRL.toFixed(2)}, Final R$ ${preview.totals.finalSurplusBRL.toFixed(2)})`
    );

    if (apply) {
      if (existingBudget && !replaceMonth) {
        console.log(
          "  Skipped existing month (pass --replace-month to overwrite)."
        );
      } else {
        await prisma.$transaction(async (tx) => {
          if (existingBudget) {
            await tx.monthlyBudget.delete({ where: { id: existingBudget.id } });
          }

          const budget = await tx.monthlyBudget.create({
            data: {
              userId: user.id,
              year: parsed.year,
              month: parsed.month,
              checkingBalance: parsed.checkingBalance,
              reportDate: new Date(`${parsed.reportDate}T12:00:00.000Z`),
            },
          });

          if (parsed.incomes.length > 0) {
            await tx.monthlyIncome.createMany({
              data: parsed.incomes.map((item) => ({
                userId: user.id,
                budgetId: budget.id,
                ...item,
              })),
            });
          }

          if (parsed.expenses.length > 0) {
            await tx.monthlyExpense.createMany({
              data: parsed.expenses.map((item) => ({
                userId: user.id,
                budgetId: budget.id,
                ...item,
              })),
            });
          }

          if (parsed.allocations.length > 0) {
            await tx.monthlyAllocation.createMany({
              data: parsed.allocations.map((item) => ({
                userId: user.id,
                budgetId: budget.id,
                kind: item.kind,
                name: item.name,
                savingsGoalId: item.goalName
                  ? (goalIdByNormName.get(normalizeKey(item.goalName)) ?? null)
                  : null,
                amount: item.amount,
                isExecuted: item.isExecuted,
                isRecurring: item.isRecurring,
                sortOrder: item.sortOrder,
              })),
            });
          }
        });

        console.log("  Applied monthly budget successfully.");
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("Import error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
