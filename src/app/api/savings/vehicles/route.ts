import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const createVehicleSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do produto/título").max(80),
  institution: z.string().trim().max(60).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = createVehicleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { name, institution } = parsed.data;
    const existing = await prisma.savingsVehicle.findFirst({
      where: { userId: user.id, name },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Já existe um produto chamado "${name}".` },
        { status: 409 }
      );
    }

    const vehicle = await prisma.savingsVehicle.create({
      data: {
        userId: user.id,
        name,
        institution: institution?.trim() || null,
      },
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Já existe um produto com este nome." },
        { status: 409 }
      );
    }
    console.error("POST /api/savings/vehicles error:", err);
    return NextResponse.json(
      { error: "Erro ao criar produto" },
      { status: 500 }
    );
  }
}
