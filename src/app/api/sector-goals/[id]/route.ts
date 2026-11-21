import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  buildSectorGoalEntityLabel,
  ensureAuditBackfill,
  recordAuditEvent,
  toSectorGoalSnapshot,
} from "@/lib/audit-service";
import type { VariableIncomeClassKey } from "@/lib/domain/types";

const updateSectorGoalSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Informe o nome do setor.")
      .max(100, "Nome do setor muito longo.")
      .optional(),
    targetPct: z.coerce
      .number()
      .min(0, "Percentual mínimo é 0%.")
      .max(100, "Percentual máximo é 100%.")
      .optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.targetPct !== undefined,
    "Informe ao menos um campo para atualizar."
  );

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateSectorGoalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Dados inválidos" },
        { status: 400 }
      );
    }

    await ensureAuditBackfill(user.id);

    const existing = await prisma.sectorGoal.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Objetivo de setor não encontrado" },
        { status: 404 }
      );
    }

    const nextName = parsed.data.name ?? existing.name;
    const nextTargetPct =
      parsed.data.targetPct !== undefined
        ? Math.round(parsed.data.targetPct * 100) / 100
        : Number(existing.targetPct);

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.sectorGoal.update({
        where: { id: existing.id },
        data: {
          name: nextName,
          targetPct: nextTargetPct,
        },
      });

      // Renomeia automaticamente os ativos vinculados se o nome do setor mudou
      if (existing.name !== nextName) {
        await tx.asset.updateMany({
          where: {
            userId: user.id,
            assetClass: existing.assetClass,
            sector: existing.name,
          },
          data: { sector: nextName },
        });
      }

      const beforeSnap = toSectorGoalSnapshot(existing);
      const afterSnap = toSectorGoalSnapshot(result);

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SECTOR_GOAL",
        entityId: result.id,
        entityLabel: buildSectorGoalEntityLabel(afterSnap),
        action: "UPDATE",
        beforeState: beforeSnap,
        afterState: afterSnap,
      });

      return result;
    });

    return NextResponse.json({
      sectorGoal: {
        id: updated.id,
        assetClass: updated.assetClass as VariableIncomeClassKey,
        name: updated.name,
        targetPct: Number(updated.targetPct),
      },
    });
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
    console.error("PATCH /api/sector-goals/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar objetivo de setor" },
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

    await ensureAuditBackfill(user.id);

    const existing = await prisma.sectorGoal.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Objetivo de setor não encontrado" },
        { status: 404 }
      );
    }

    const linkedAssets = await prisma.asset.findMany({
      where: {
        userId: user.id,
        assetClass: existing.assetClass,
        sector: existing.name,
      },
      select: { ticker: true },
      orderBy: { ticker: "asc" },
    });

    if (linkedAssets.length > 0) {
      const tickers = linkedAssets.map((a) => a.ticker);
      return NextResponse.json(
        {
          error: `Não é possível excluir o setor "${existing.name}" pois existem ativos vinculados: ${tickers.join(", ")}. Reatribua esses ativos antes de excluir.`,
          linkedTickers: tickers,
        },
        { status: 409 }
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.sectorGoal.delete({ where: { id: existing.id } });

      const beforeSnap = toSectorGoalSnapshot(existing);
      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "SECTOR_GOAL",
        entityId: existing.id,
        entityLabel: buildSectorGoalEntityLabel(beforeSnap),
        action: "DELETE",
        beforeState: beforeSnap,
        afterState: null,
      });
    });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/sector-goals/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir objetivo de setor" },
      { status: 500 }
    );
  }
}
