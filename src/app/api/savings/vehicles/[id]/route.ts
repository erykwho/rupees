import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invalidateUserSavingsCaches } from "@/lib/server-cache";

const updateVehicleSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  institution: z.string().trim().max(60).nullable().optional(),
  isArchived: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = await request.json();
    const parsed = updateVehicleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const existing = await prisma.savingsVehicle.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 }
      );
    }

    const data = parsed.data;
    if (data.name && data.name !== existing.name) {
      const conflict = await prisma.savingsVehicle.findFirst({
        where: { userId: user.id, name: data.name, id: { not: id } },
        select: { id: true },
      });
      if (conflict) {
        return NextResponse.json(
          { error: `Já existe um produto chamado "${data.name}".` },
          { status: 409 }
        );
      }
    }

    const vehicle = await prisma.savingsVehicle.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.institution !== undefined
          ? { institution: data.institution?.trim() || null }
          : {}),
        ...(data.isArchived !== undefined ? { isArchived: data.isArchived } : {}),
      },
    });

    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ vehicle });
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
    console.error("PATCH /api/savings/vehicles/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar produto" },
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

    const existing = await prisma.savingsVehicle.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json(
        { error: "Produto não encontrado" },
        { status: 404 }
      );
    }

    const movementCount = await prisma.savingsMovement.count({
      where: { userId: user.id, vehicleId: id },
    });
    if (movementCount > 0) {
      return NextResponse.json(
        {
          error: `Este produto possui ${movementCount} movimentação(ões) vinculada(s). Arquive o produto em vez de excluí-lo.`,
        },
        { status: 409 }
      );
    }

    await prisma.savingsVehicle.delete({ where: { id } });
    invalidateUserSavingsCaches(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/savings/vehicles/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao excluir produto" },
      { status: 500 }
    );
  }
}
