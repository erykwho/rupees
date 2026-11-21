import { prisma } from "@/lib/prisma";
import {
  VARIABLE_INCOME_CLASSES,
  type VariableIncomeClassKey,
} from "@/lib/domain/types";

/**
 * Popula automaticamente os objetivos de setor (SectorGoal) a partir dos setores
 * já existentes nos ativos de Renda Variável do usuário caso ele ainda não possua
 * nenhum registro em SectorGoal. Operação idempotente.
 */
export async function ensureSectorGoalsBackfill(userId: string): Promise<void> {
  const existing = await prisma.sectorGoal.findFirst({
    where: { userId },
    select: { id: true },
  });
  if (existing) return;

  await prisma.$transaction(async (tx) => {
    const doubleCheck = await tx.sectorGoal.findFirst({
      where: { userId },
      select: { id: true },
    });
    if (doubleCheck) return;

    const viAssets = await tx.asset.findMany({
      where: {
        userId,
        assetClass: { in: VARIABLE_INCOME_CLASSES },
      },
      select: {
        assetClass: true,
        sector: true,
        targetPctInClass: true,
        isActive: true,
      },
    });

    if (viAssets.length === 0) return;

    const grouped = new Map<
      string,
      { assetClass: VariableIncomeClassKey; name: string; targetPct: number }
    >();

    for (const asset of viAssets) {
      const name = asset.sector.trim() || "Outros";
      const assetClass = asset.assetClass as VariableIncomeClassKey;
      const key = `${assetClass}::${name}`;
      const existingGroup = grouped.get(key);
      const pct = asset.isActive ? Number(asset.targetPctInClass) : 0;

      if (existingGroup) {
        existingGroup.targetPct += pct;
      } else {
        grouped.set(key, {
          assetClass,
          name,
          targetPct: pct,
        });
      }
    }

    const rows = Array.from(grouped.values()).map((g) => ({
      userId,
      assetClass: g.assetClass,
      name: g.name,
      targetPct: Math.min(100, Math.round(g.targetPct * 100) / 100),
    }));

    if (rows.length > 0) {
      await tx.sectorGoal.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
  });
}
