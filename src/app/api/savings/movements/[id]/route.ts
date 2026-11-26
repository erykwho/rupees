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

const updateSingleMovementSchema = z.object({
  goalId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)")
    .optional(),
  signedAmount: z
    .number()
    .refine((v) => Math.abs(v) >= 0.01, "Informe um valor diferente de zero")
    .optional(),
  notes: z.string().trim().max(300).nullable().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateSingleMovementSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.savingsMovement.findFirst({
      where: { id, userId: user.id },
      include: {
        goal: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Movimentação não encontrada" },
        { status: 404 }
      );
    }

    if (existing.transferGroupId) {
      return NextResponse.json(
        {
          error:
            "Transferências em par não podem ser editadas isoladamente. Exclua e registre uma nova transferência.",
        },
        { status: 400 }
      );
    }

    const data = parsed.data;
    if (data.goalId && data.goalId !== existing.goalId) {
      const goal = await prisma.savingsGoal.findFirst({
        where: { id: data.goalId, userId: user.id },
        select: { id: true },
      });
      if (!goal) {
        return NextResponse.json(
          { error: "Caixinha não encontrada" },
          { status: 404 }
        );
      }
    }

    if (data.vehicleId && data.vehicleId !== existing.vehicleId) {
      const vehicle = await prisma.savingsVehicle.findFirst({
        where: { id: data.vehicleId, userId: user.id },
        select: { id: true },
      });
      if (!vehicle) {
        return NextResponse.json(
          { error: "Produto não encontrado" },
          { status: 404 }
        );
      }
    }

    let nextSignedAmount =
      data.signedAmount !== undefined
        ? roundMoney(data.signedAmount)
        : Number(existing.signedAmount);

    if (existing.type === "DEPOSIT" && nextSignedAmount < 0) {
      nextSignedAmount = Math.abs(nextSignedAmount);
    } else if (existing.type === "WITHDRAWAL" && nextSignedAmount > 0) {
      nextSignedAmount = -Math.abs(nextSignedAmount);
    }

    const beforeSnapshot = toSavingsMovementSnapshot(existing);

    const afterSnapshot = await prisma.$transaction(async (tx) => {
      const updated = await tx.savingsMovement.update({
        where: { id },
        data: {
          ...(data.goalId !== undefined ? { goalId: data.goalId } : {}),
          ...(data.vehicleId !== undefined
            ? { vehicleId: data.vehicleId }
            : {}),
          ...(data.date !== undefined
            ? { date: new Date(`${data.date}T12:00:00.000Z`) }
            : {}),
          ...(data.signedAmount !== undefined
            ? { signedAmount: nextSignedAmount }
            : {}),
          ...(data.notes !== undefined
            ? { notes: data.notes?.trim() || null }
            : {}),
        },
        include: {
          goal: { select: { id: true, name: true } },
          vehicle: { select: { id: true, name: true } },
        },
      });

      const snap = toSavingsMovementSnapshot(updated);
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_MOVEMENT",
        entityId: updated.id,
        entityLabel: buildSavingsMovementEntityLabel(snap),
        action: "UPDATE",
        beforeState: beforeSnapshot,
        afterState: snap,
      });

      return snap;
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ movement: afterSnapshot });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("PATCH /api/savings/movements/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar movimentação" },
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

    const existing = await prisma.savingsMovement.findFirst({
      where: { id, userId: user.id },
      include: {
        goal: { select: { id: true, name: true } },
        vehicle: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Movimentação não encontrada" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      if (existing.transferGroupId) {
        const pair = await tx.savingsMovement.findMany({
          where: {
            userId: user.id,
            transferGroupId: existing.transferGroupId,
          },
          include: {
            goal: { select: { id: true, name: true } },
            vehicle: { select: { id: true, name: true } },
          },
        });
        const outLeg =
          pair.find((m) => m.type === "TRANSFER_OUT") ?? existing;
        const inLeg =
          pair.find((m) => m.id !== outLeg.id) ?? null;

        const idsToDelete = pair.map((m) => m.id);
        await tx.monthlyAllocation.updateMany({
          where: { userId: user.id, linkedMovementId: { in: idsToDelete } },
          data: { linkedMovementId: null },
        });
        await tx.savingsMovement.deleteMany({
          where: { userId: user.id, id: { in: idsToDelete } },
        });

        const beforeSnap = toSavingsMovementSnapshot(outLeg, inLeg);
        await recordAuditEvent(tx, {
          userId: user.id,
          entityType: "SAVINGS_MOVEMENT",
          entityId: outLeg.id,
          entityLabel: buildSavingsMovementEntityLabel(beforeSnap),
          action: "DELETE",
          beforeState: beforeSnap,
          afterState: null,
        });
        return;
      }

      const beforeSnap = toSavingsMovementSnapshot(existing);
      await tx.monthlyAllocation.updateMany({
        where: { userId: user.id, linkedMovementId: existing.id },
        data: { linkedMovementId: null },
      });
      await tx.savingsMovement.delete({ where: { id: existing.id } });
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_MOVEMENT",
        entityId: existing.id,
        entityLabel: buildSavingsMovementEntityLabel(beforeSnap),
        action: "DELETE",
        beforeState: beforeSnap,
        afterState: null,
      });
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/savings/movements/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir movimentação" },
      { status: 500 }
    );
  }
}
