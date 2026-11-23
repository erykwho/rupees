import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureSectorGoalsBackfill } from "@/lib/sector-goals";
import {
  buildSectorGoalEntityLabel,
  ensureAuditBackfill,
  recordAuditEvent,
  toSectorGoalSnapshot,
} from "@/lib/audit-service";
import { invalidateUserFinancialCaches } from "@/lib/server-cache";
import type { VariableIncomeClassKey } from "@/lib/domain/types";

const createSectorGoalSchema = z.object({
  assetClass: z.enum(["BR_STOCK", "BR_FII", "US_STOCK", "US_REIT"]),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome do setor.")
    .max(100, "Nome do setor muito longo."),
  targetPct: z.coerce
    .number()
    .min(0, "Percentual mínimo é 0%.")
    .max(100, "Percentual máximo é 100%.")
    .default(0),
});

export async function GET() {
  try {
    const user = await requireUser();
    await ensureSectorGoalsBackfill(user.id);

    const rows = await prisma.sectorGoal.findMany({
      where: { userId: user.id },
      orderBy: [{ assetClass: "asc" }, { targetPct: "desc" }, { name: "asc" }],
    });

    const sectorGoals = rows.map((sg) => ({
      id: sg.id,
      assetClass: sg.assetClass as VariableIncomeClassKey,
      name: sg.name,
      targetPct: Number(sg.targetPct),
    }));

    return NextResponse.json({ sectorGoals });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/sector-goals error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar objetivos por setor" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createSectorGoalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: parsed.error.issues[0]?.message ?? "Dados inválidos",
        },
        { status: 400 }
      );
    }

    await ensureSectorGoalsBackfill(user.id);
    await ensureAuditBackfill(user.id);

    const { assetClass, name, targetPct } = parsed.data;
    const roundedTarget = Math.round(targetPct * 100) / 100;

    const created = await prisma.$transaction(async (tx) => {
      const sg = await tx.sectorGoal.create({
        data: {
          userId: user.id,
          assetClass,
          name,
          targetPct: roundedTarget,
        },
      });

      const snap = toSectorGoalSnapshot(sg);
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SECTOR_GOAL",
        entityId: sg.id,
        entityLabel: buildSectorGoalEntityLabel(snap),
        action: "CREATE",
        beforeState: null,
        afterState: snap,
      });

      return sg;
    });

    invalidateUserFinancialCaches(user.id);
    return NextResponse.json(
      {
        sectorGoal: {
          id: created.id,
          assetClass: created.assetClass as VariableIncomeClassKey,
          name: created.name,
          targetPct: Number(created.targetPct),
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Já existe um setor com esse nome nesta classe." },
        { status: 409 }
      );
    }
    console.error("POST /api/sector-goals error:", err);
    return NextResponse.json(
      { error: "Erro ao criar objetivo de setor" },
      { status: 500 }
    );
  }
}
