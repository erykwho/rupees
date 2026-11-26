import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent, toSavingsGoalSnapshot } from "@/lib/audit-service";
import { evaluateEmergencyReserveCalculator } from "@/lib/domain/savings";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const scenarioSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1, "Informe o nome do cenário").max(100),
  mode: z.enum(["MONTHS", "FIXED"]),
  months: z.number().min(0).max(120).nullable().optional(),
  fixedAmount: z.number().min(0).nullable().optional(),
});

const reserveCalculatorSchema = z.object({
  monthlyExpenseBRL: z.number().min(0),
  scenarios: z.array(scenarioSchema).min(1).max(12),
  applyToReserveGoal: z.boolean().optional(),
});

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = reserveCalculatorSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { monthlyExpenseBRL, scenarios, applyToReserveGoal } = parsed.data;
    const evaluated = evaluateEmergencyReserveCalculator({
      monthlyExpenseBRL,
      scenarios,
    });

    const sanitizedScenarios = evaluated.scenarios.map((s) => ({
      id: s.id,
      label: s.label,
      mode: s.mode,
      months: s.mode === "MONTHS" ? (s.months ?? 0) : null,
      fixedAmount: s.mode === "FIXED" ? (s.fixedAmount ?? 0) : null,
    }));

    const result = await prisma.$transaction(async (tx) => {
      await tx.emergencyReserveConfig.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          monthlyExpense: evaluated.monthlyExpenseBRL,
          scenariosJson: sanitizedScenarios as unknown as Prisma.InputJsonValue,
        },
        update: {
          monthlyExpense: evaluated.monthlyExpenseBRL,
          scenariosJson: sanitizedScenarios as unknown as Prisma.InputJsonValue,
        },
      });

      let appliedGoalId: string | null = null;
      if (applyToReserveGoal && evaluated.recommendedTargetBRL > 0) {
        const reserveGoal = await tx.savingsGoal.findFirst({
          where: { userId: user.id, isEmergencyReserve: true },
        });
        if (reserveGoal) {
          const beforeSnap = toSavingsGoalSnapshot(reserveGoal);
          const updated = await tx.savingsGoal.update({
            where: { id: reserveGoal.id },
            data: { targetAmount: evaluated.recommendedTargetBRL },
          });
          await recordAuditEvent(tx, {
            userId: user.id,
            entityType: "SAVINGS_GOAL",
            entityId: updated.id,
            entityLabel: updated.name,
            action: "UPDATE",
            beforeState: beforeSnap,
            afterState: toSavingsGoalSnapshot(updated),
          });
          appliedGoalId = updated.id;
        }
      }

      return { appliedGoalId };
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({
      reserveCalculator: evaluated,
      appliedGoalId: result.appliedGoalId,
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("PUT /api/savings/reserve-calculator error:", err);
    return NextResponse.json(
      { error: "Erro ao salvar calculadora da reserva" },
      { status: 500 }
    );
  }
}
