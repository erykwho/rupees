import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureAuditBackfill,
  recordAuditEvent,
  toAssetSnapshot,
} from "@/lib/audit-service";

const createAssetSchema = z.object({
  ticker: z.string().trim().min(1).max(20),
  assetClass: z.enum([
    "FIXED_INCOME",
    "BR_STOCK",
    "BR_FII",
    "US_STOCK",
    "US_REIT",
    "EMERGENCY_RESERVE",
  ]),
  sector: z.string().trim().min(1).max(100).default("Outros"),
  targetPctInClass: z.coerce.number().min(0).max(100).default(0),
  priceMode: z.enum(["AUTO_YAHOO", "MANUAL"]).optional(),
  manualPrice: z.coerce.number().positive().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const assets = await prisma.asset.findMany({
      where: { userId: user.id },
      orderBy: [{ assetClass: "asc" }, { ticker: "asc" }],
    });
    return NextResponse.json({ assets });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json({ error: "Erro ao listar ativos" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createAssetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ticker, assetClass, sector, targetPctInClass, manualPrice, isActive } =
      parsed.data;

    const normalizedTicker = ticker.toUpperCase();
    const currency =
      assetClass === "US_STOCK" || assetClass === "US_REIT" ? "USD" : "BRL";
    const priceMode =
      parsed.data.priceMode ??
      (assetClass === "FIXED_INCOME" || assetClass === "EMERGENCY_RESERVE"
        ? "MANUAL"
        : "AUTO_YAHOO");

    await ensureAuditBackfill(user.id);

    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          userId: user.id,
          ticker: normalizedTicker,
          assetClass,
          sector,
          currency,
          targetPctInClass,
          priceMode,
          manualPrice:
            priceMode === "MANUAL" ? (manualPrice ?? 1) : (manualPrice ?? null),
          isActive: isActive ?? true,
        },
      });

      await recordAuditEvent(tx, {
        userId: user.id,
        entityType: "ASSET",
        entityId: created.id,
        entityLabel: created.ticker,
        action: "CREATE",
        beforeState: null,
        afterState: toAssetSnapshot(created),
      });

      return created;
    });

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Este ticker já existe na sua carteira." },
        { status: 409 }
      );
    }
    console.error("POST /api/assets error:", err);
    return NextResponse.json({ error: "Erro ao criar ativo" }, { status: 500 });
  }
}
