import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSavingsMovementEntityLabel,
  recordAuditEvent,
  toSavingsMovementSnapshot,
} from "@/lib/audit-service";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const dateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)");

const createMovementSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("DEPOSIT"),
    goalId: z.string().min(1),
    vehicleId: z.string().min(1),
    date: dateField,
    amount: z.number().positive("O valor deve ser maior que zero"),
    notes: z.string().trim().max(300).nullable().optional(),
  }),
  z.object({
    mode: z.literal("WITHDRAWAL"),
    goalId: z.string().min(1),
    vehicleId: z.string().min(1),
    date: dateField,
    amount: z.number().positive("O valor deve ser maior que zero"),
    notes: z.string().trim().max(300).nullable().optional(),
  }),
  z.object({
    mode: z.literal("YIELD_ADJUSTMENT"),
    goalId: z.string().min(1),
    vehicleId: z.string().min(1),
    date: dateField,
    signedAmount: z
      .number()
      .refine((v) => Math.abs(v) >= 0.01, "Informe um valor diferente de zero"),
    notes: z.string().trim().max(300).nullable().optional(),
  }),
  z
    .object({
      mode: z.literal("TRANSFER"),
      sourceGoalId: z.string().min(1),
      sourceVehicleId: z.string().min(1),
      destGoalId: z.string().min(1),
      destVehicleId: z.string().min(1),
      date: dateField,
      amount: z.number().positive("O valor deve ser maior que zero"),
      notes: z.string().trim().max(300).nullable().optional(),
    })
    .refine(
      (d) =>
        d.sourceGoalId !== d.destGoalId ||
        d.sourceVehicleId !== d.destVehicleId,
      {
        message: "Origem e destino precisam diferir na caixinha ou no produto",
      }
    ),
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createMovementSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const movementDate = new Date(`${data.date}T12:00:00.000Z`);

    if (data.mode === "TRANSFER") {
      const uniqueGoalIds = [...new Set([data.sourceGoalId, data.destGoalId])];
      const uniqueVehicleIds = [
        ...new Set([data.sourceVehicleId, data.destVehicleId]),
      ];

      const [goals, vehicles] = await Promise.all([
        prisma.savingsGoal.findMany({
          where: { userId: user.id, id: { in: uniqueGoalIds } },
          select: { id: true },
        }),
        prisma.savingsVehicle.findMany({
          where: { userId: user.id, id: { in: uniqueVehicleIds } },
          select: { id: true },
        }),
      ]);

      if (goals.length !== uniqueGoalIds.length) {
        return NextResponse.json(
          { error: "Caixinha de origem ou destino não encontrada" },
          { status: 404 }
        );
      }
      if (vehicles.length !== uniqueVehicleIds.length) {
        return NextResponse.json(
          { error: "Produto de origem ou destino não encontrado" },
          { status: 404 }
        );
      }

      const amount = roundMoney(data.amount);
      const transferGroupId = `tr_${crypto.randomUUID()}`;
      const notes = data.notes?.trim() || null;

      const snapshot = await prisma.$transaction(async (tx) => {
        const outLeg = await tx.savingsMovement.create({
          data: {
            userId: user.id,
            goalId: data.sourceGoalId,
            vehicleId: data.sourceVehicleId,
            date: movementDate,
            type: "TRANSFER_OUT",
            signedAmount: -amount,
            transferGroupId,
            notes,
          },
          include: {
            goal: { select: { id: true, name: true } },
            vehicle: { select: { id: true, name: true } },
          },
        });

        const inLeg = await tx.savingsMovement.create({
          data: {
            userId: user.id,
            goalId: data.destGoalId,
            vehicleId: data.destVehicleId,
            date: movementDate,
            type: "TRANSFER_IN",
            signedAmount: amount,
            transferGroupId,
            notes,
          },
          include: {
            goal: { select: { id: true, name: true } },
            vehicle: { select: { id: true, name: true } },
          },
        });

        const snap = toSavingsMovementSnapshot(outLeg, inLeg);
        await recordAuditEvent(tx, {
          userId: user.id,
          entityType: "SAVINGS_MOVEMENT",
          entityId: outLeg.id,
          entityLabel: buildSavingsMovementEntityLabel(snap),
          action: "CREATE",
          beforeState: null,
          afterState: snap,
        });

        return snap;
      });

      invalidateUserSavingsCaches(user.id);
      return NextResponse.json({ movement: snapshot }, { status: 201 });
    }

    // Single movement: DEPOSIT | WITHDRAWAL | YIELD_ADJUSTMENT
    const [goal, vehicle] = await Promise.all([
      prisma.savingsGoal.findFirst({
        where: { id: data.goalId, userId: user.id },
        select: { id: true },
      }),
      prisma.savingsVehicle.findFirst({
        where: { id: data.vehicleId, userId: user.id },
        select: { id: true },
      }),
    ]);

    if (!goal) {
      return NextResponse.json(
        { error: "Caixinha não encontrada" },
        { status: 404 }
      );
    }
    if (!vehicle) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 }
      );
    }

    const signedAmount =
      data.mode === "DEPOSIT"
        ? roundMoney(data.amount)
        : data.mode === "WITHDRAWAL"
          ? -roundMoney(data.amount)
          : roundMoney(data.signedAmount);

    const snapshot = await prisma.$transaction(async (tx) => {
      const created = await tx.savingsMovement.create({
        data: {
          userId: user.id,
          goalId: data.goalId,
          vehicleId: data.vehicleId,
          date: movementDate,
          type: data.mode,
          signedAmount,
          notes: data.notes?.trim() || null,
        },
        include: {
          goal: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true } },
        },
      });

      const snap = toSavingsMovementSnapshot(created);
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_MOVEMENT",
        entityId: created.id,
        entityLabel: buildSavingsMovementEntityLabel(snap),
        action: "CREATE",
        beforeState: null,
        afterState: snap,
      });

      return snap;
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ movement: snapshot }, { status: 201 });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("POST /api/savings/movements error:", err);
    return NextResponse.json(
      { error: "Erro ao registrar movimentação" },
      { status: 500 }
    );
  }
}
