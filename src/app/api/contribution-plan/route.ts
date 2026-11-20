import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { loadUserPortfolio } from "@/lib/portfolio-loader";
import { computeContributionPlan } from "@/lib/domain/calculations";
import type { InvestmentClassKey } from "@/lib/domain/types";

const planSchema = z.object({
  amountBRL: z.coerce.number().min(0),
  maxAssets: z.coerce.number().int().min(1).max(20).default(3),
  ignoredClasses: z
    .array(
      z.enum(["FIXED_INCOME", "BR_STOCK", "BR_FII", "US_STOCK", "US_REIT"])
    )
    .optional(),
  ignoredTickers: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = planSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Parâmetros inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { summary } = await loadUserPortfolio(user.id);
    const plan = computeContributionPlan({
      summary,
      amountBRL: parsed.data.amountBRL,
      maxAssets: parsed.data.maxAssets,
      ignoredClasses: parsed.data.ignoredClasses as
        | InvestmentClassKey[]
        | undefined,
      ignoredTickers: parsed.data.ignoredTickers,
    });

    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error("POST /api/contribution-plan error:", err);
    return NextResponse.json(
      { error: "Erro ao calcular plano de aporte" },
      { status: 500 }
    );
  }
}
