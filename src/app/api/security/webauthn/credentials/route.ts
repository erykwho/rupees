import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireUser();
    const credentials = await prisma.webAuthnCredential.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
      },
    });

    return NextResponse.json({
      credentials: credentials.map((cred) => ({
        id: cred.id,
        deviceName: cred.deviceName,
        createdAt: cred.createdAt.toISOString(),
        lastUsedAt: cred.lastUsedAt ? cred.lastUsedAt.toISOString() : null,
      })),
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/security/webauthn/credentials error:", err);
    return NextResponse.json(
      { error: "Erro ao listar dispositivos cadastrados." },
      { status: 500 }
    );
  }
}
