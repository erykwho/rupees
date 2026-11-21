import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const existing = await prisma.webAuthnCredential.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Dispositivo não encontrado." },
        { status: 404 }
      );
    }

    await prisma.webAuthnCredential.delete({
      where: { id: existing.id },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("DELETE /api/security/webauthn/credentials/[id] error:", err);
    return NextResponse.json(
      { error: "Erro ao remover dispositivo." },
      { status: 500 }
    );
  }
}
