import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const goalSchema = z
  .object({
    fixedIncomePct: z.coerce.number().min(0).max(100),
    variableIncomePct: z.coerce.number().min(0).max(100),
    brazilPct: z.coerce.number().min(0).max(100),
    usaPct: z.coerce.number().min(0).max(100),
    brStocksPct: z.coerce.number().min(0).max(100),
    brFiisPct: z.coerce.number().min(0).max(100),
    usStocksPct: z.coerce.number().min(0).max(100),
    usReitsPct: z.coerce.number().min(0).max(100),
  })
  .refine(
    (g) => Math.abs(g.fixedIncomePct + g.variableIncomePct - 100) < 0.01,
    "Renda Fixa + Renda Variável deve somar 100%"
  )
  .refine(
    (g) => Math.abs(g.brazilPct + g.usaPct - 100) < 0.01,
    "Brasil + EUA deve somar 100%"
  )
  .refine(
    (g) => Math.abs(g.brStocksPct + g.brFiisPct - 100) < 0.01,
    "Ações + FIIs deve somar 100%"
  )
  .refine(
    (g) => Math.abs(g.usStocksPct + g.usReitsPct - 100) < 0.01,
    "Stocks + REITs deve somar 100%"
  );

export async function GET() {
  try {
    const user = await requireUser();
    const goal = await prisma.allocationGoal.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    return NextResponse.json({ goal });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao carregar objetivos" },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = goalSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.issues[0]?.message ?? "Os objetivos devem somar 100%.",
        },
        { status: 400 }
      );
    }

    const goal = await prisma.allocationGoal.upsert({
      where: { userId: user.id },
      update: parsed.data,
      create: { userId: user.id, ...parsed.data },
    });

    return NextResponse.json({ goal });
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Erro ao salvar objetivos" },
      { status: 500 }
    );
  }
}
