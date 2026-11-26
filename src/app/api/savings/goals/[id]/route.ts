import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent, toSavingsGoalSnapshot } from "@/lib/audit-service";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const updateSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetAmount: z.number().nonnegative().nullable().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)")
    .nullable()
    .optional(),
  isEmergencyReserve: z.boolean().optional(),
  isClosed: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateSavingsGoalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.savingsGoal.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Caixinha não encontrada" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    if (data.name && data.name !== existing.name) {
      const conflict = await prisma.savingsGoal.findFirst({
        where: { userId: user.id, name: data.name, id: { not: id } },
        select: { id: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `Já existe uma caixinha chamada "${data.name}".` },
          { status: 409 }
        );
      }
    }

    const beforeSnapshot = toSavingsGoalSnapshot(existing);

    const updated = await prisma.$transaction(async (tx) => {
      if (data.isEmergencyReserve === true) {
        await tx.savingsGoal.updateMany({
          where: { userId: user.id, isEmergencyReserve: true, id: { not: id } },
          data: { isEmergencyReserve: false },
        });
      }

      const nextGoal = await tx.savingsGoal.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.targetAmount !== undefined
            ? {
                targetAmount:
                  data.targetAmount !== null && data.targetAmount > 0
                    ? data.targetAmount
                    : null,
              }
            : {}),
          ...(data.targetDate !== undefined
            ? {
                targetDate: data.targetDate
                  ? new Date(`${data.targetDate}T12:00:00.000Z`)
                  : null,
              }
            : {}),
          ...(data.isEmergencyReserve !== undefined
            ? { isEmergencyReserve: data.isEmergencyReserve }
            : {}),
          ...(data.isClosed !== undefined ? { isClosed: data.isClosed } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
      });

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_GOAL",
        entityId: nextGoal.id,
        entityLabel: nextGoal.name,
        action: "UPDATE",
        beforeState: beforeSnapshot,
        afterState: toSavingsGoalSnapshot(nextGoal),
      });

      return nextGoal;
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ goal: toSavingsGoalSnapshot(updated) });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Já existe uma caixinha com este nome." },
        { status: 409 }
      );
    }
    console.error("PATCH /api/savings/goals/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar caixinha" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.savingsGoal.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Caixinha não encontrada" },
        { status: 404 }
      );
    }

    const movementCount = await prisma.savingsMovement.count({
      where: { userId: user.id, goalId: id },
    });
    if (movementCount > 0) {
      return NextResponse.json(
        {
          error: `Esta caixinha possui ${movementCount} movimentação(ões) vinculada(s). Encerre/arquive a caixinha em vez de excluí-la.`,
        },
        { status: 409 }
      );
    }

    const beforeSnapshot = toSavingsGoalSnapshot(existing);

    await prisma.$transaction(async (tx) => {
      await tx.savingsGoal.delete({ where: { id } });
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_GOAL",
        entityId: existing.id,
        entityLabel: existing.name,
        action: "DELETE",
        beforeState: beforeSnapshot,
        afterState: null,
      });
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/savings/goals/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir caixinha" },
      { status: 500 }
    );
  }
}
