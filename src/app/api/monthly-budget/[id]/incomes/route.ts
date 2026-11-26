import { NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { roundMoney } from "@/lib/domain/savings";
import { invalidateUserMonthlyBudgetCaches } from "@/lib/server-cache";

const createIncomeSchema = z.object({
  name: z.string().trim().min(1, "Informe a descrição da receita").max(100),
  amount: z.number().min(0),
  isReceived: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: budgetId } = await context.params;
    const body = await request.json();
    const parsed = createIncomeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const budget = await prisma.monthlyBudget.findFirst({
      where: { id: budgetId, userId: user.id },
      select: { id: true },
    });
    if (!budget) {
      return NextResponse.json(
        { error: "Controle mensal não encontrado" },
        { status: 404 }
      );
    }

    const count = await prisma.monthlyIncome.count({ where: { budgetId } });
    const created = await prisma.monthlyIncome.create({
      data: {
        userId: user.id,
        budgetId,
        name: parsed.data.name,
        amount: roundMoney(parsed.data.amount),
        isReceived: parsed.data.isReceived ?? false,
        isRecurring: parsed.data.isRecurring ?? true,
        sortOrder: parsed.data.sortOrder ?? count,
      },
    });

    invalidateUserMonthlyBudgetCaches(user.id);
    return NextResponse.json(
      {
        income: {
          id: created.id,
          name: created.name,
          amount: Number(created.amount),
          isReceived: created.isReceived,
          isRecurring: created.isRecurring,
          sortOrder: created.sortOrder,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("POST /api/monthly-budget/[id]/incomes error:", err);
    return NextResponse.json(
      { error: "Erro ao adicionar receita" },
      { status: 500 }
    );
  }
}
