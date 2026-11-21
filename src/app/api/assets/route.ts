import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  ensureAuditBackfill,
  recordAuditEvent,
  toAssetSnapshot,
} from "@/lib/audit-service";
import {
  type AssetClassKey,
  type TickerValidationStatusKey,
  isVariableIncomeClass,
} from "@/lib/domain/types";
import { normalizeTicker } from "@/lib/domain/ticker-validation";
import { validateTickerOnYahoo } from "@/lib/ticker-validator";

const fixedIncomeIndexSchema = z
  .enum([
    "CDI_PCT",
    "CDI_PLUS",
    "SELIC_PCT",
    "SELIC_PLUS",
    "IPCA_PLUS",
    "PREFIXED",
  ])
  .nullable()
  .optional();

const createAssetSchema = z.object({
  ticker: z.string().trim().min(1).max(30),
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
  fixedIncomeIndex: fixedIncomeIndexSchema,
  fixedIncomeRate: z.coerce.number().min(0).max(1000).nullable().optional(),
  maturityDate: z.string().trim().nullable().optional(),
  taxExempt: z.boolean().optional(),
  allowUnverifiedOnUnavailable: z.boolean().optional(),
});

function parseOptionalMaturityDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(
    raw.includes("T") ? raw : `${raw.slice(0, 10)}T12:00:00.000Z`
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

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

    const {
      ticker,
      assetClass,
      sector,
      targetPctInClass,
      manualPrice,
      isActive,
      fixedIncomeIndex,
      fixedIncomeRate,
      maturityDate,
      taxExempt,
      allowUnverifiedOnUnavailable,
    } = parsed.data;

    const normalizedTicker = normalizeTicker(ticker, assetClass as AssetClassKey);
    const currency =
      assetClass === "US_STOCK" || assetClass === "US_REIT" ? "USD" : "BRL";
    const isFixedIncome =
      assetClass === "FIXED_INCOME" || assetClass === "EMERGENCY_RESERVE";
    const priceMode =
      parsed.data.priceMode ?? (isFixedIncome ? "MANUAL" : "AUTO_YAHOO");

    let tickerValidationStatus: TickerValidationStatusKey = "VERIFIED";

    if (isVariableIncomeClass(assetClass as AssetClassKey)) {
      const validation = await validateTickerOnYahoo(
        normalizedTicker,
        assetClass as AssetClassKey
      );

      if (validation.status === "INVALID") {
        return NextResponse.json(
          {
            error:
              validation.reason ??
              "Ticker inválido para a bolsa da classe selecionada.",
            code: "INVALID_TICKER",
          },
          { status: 422 }
        );
      }

      if (validation.status === "UNAVAILABLE") {
        if (!allowUnverifiedOnUnavailable) {
          return NextResponse.json(
            {
              error:
                validation.reason ??
                "Não foi possível consultar o Yahoo Finance no momento.",
              code: "YAHOO_UNAVAILABLE",
            },
            { status: 503 }
          );
        }
        tickerValidationStatus = "PENDING";
      }
    }

    await ensureAuditBackfill(user.id);

    const asset = await prisma.$transaction(async (tx) => {
      if (
        assetClass === "BR_STOCK" ||
        assetClass === "BR_FII" ||
        assetClass === "US_STOCK" ||
        assetClass === "US_REIT"
      ) {
        await tx.sectorGoal.upsert({
          where: {
            userId_assetClass_name: {
              userId: user.id,
              assetClass,
              name: sector,
            },
          },
          update: {},
          create: {
            userId: user.id,
            assetClass,
            name: sector,
            targetPct: 0,
          },
        });
      }

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
          tickerValidationStatus,
          fixedIncomeIndex: isFixedIncome ? (fixedIncomeIndex ?? null) : null,
          fixedIncomeRate: isFixedIncome ? (fixedIncomeRate ?? null) : null,
          maturityDate: isFixedIncome
            ? parseOptionalMaturityDate(maturityDate)
            : null,
          taxExempt: isFixedIncome ? Boolean(taxExempt) : false,
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
