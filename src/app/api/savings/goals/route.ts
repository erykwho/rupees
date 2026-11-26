import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent, toSavingsGoalSnapshot } from "@/lib/audit-service";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const createSavingsGoalSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da caixinha").max(80),
  targetAmount: z.number().nonnegative().nullable().optional(),
  targetDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use YYYY-MM-DD)")
    .nullable()
    .optional(),
  isEmergencyReserve: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createSavingsGoalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, targetAmount, targetDate, isEmergencyReserve, sortOrder } =
      parsed.data;

    const existing = await prisma.savingsGoal.findFirst({
      where: { userId: user.id, name },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Já existe uma caixinha chamada "${name}".` },
        { status: 409 }
      );
    }

    const goal = await prisma.$transaction(async (tx) => {
      if (isEmergencyReserve) {
        await tx.savingsGoal.updateMany({
          where: { userId: user.id, isEmergencyReserve: true },
          data: { isEmergencyReserve: false },
        });
      }

      const created = await tx.savingsGoal.create({
        data: {
          userId: user.id,
          name,
          targetAmount:
            targetAmount !== undefined && targetAmount !== null && targetAmount > 0
              ? targetAmount
              : null,
          targetDate: targetDate
            ? new Date(`${targetDate}T12:00:00.000Z`)
            : null,
          isEmergencyReserve: Boolean(isEmergencyReserve),
          sortOrder: sortOrder ?? 0,
        },
      });

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SAVINGS_GOAL",
        entityId: created.id,
        entityLabel: created.name,
        action: "CREATE",
        beforeState: null,
        afterState: toSavingsGoalSnapshot(created),
      });

      return created;
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ goal: toSavingsGoalSnapshot(goal) }, { status: 201 });
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
    console.error("POST /api/savings/goals error:", err);
    return NextResponse.json(
      { error: "Erro ao criar caixinha" },
      { status: 500 }
    );
  }
}
