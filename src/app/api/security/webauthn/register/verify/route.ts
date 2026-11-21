import { NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { verifyAndSaveWebAuthnRegistration } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    if (!user.appLockEnabled) {
      return NextResponse.json(
        { error: "Ative o PIN de 6 dígitos antes de cadastrar a biometria." },
        { status: 400 }
      );
    }

    const body = (await request.json()) as {
      response?: RegistrationResponseJSON;
      deviceName?: string;
    };

    if (!body?.response || typeof body.response !== "object") {
      return NextResponse.json(
        { error: "Resposta WebAuthn inválida." },
        { status: 400 }
      );
    }

    const saved = await verifyAndSaveWebAuthnRegistration(
      user,
      body.response,
      typeof body.deviceName === "string" ? body.deviceName : "Dispositivo atual",
      request
    );

    return NextResponse.json({
      ok: true,
      credential: {
        id: saved.id,
        deviceName: saved.deviceName,
        createdAt: saved.createdAt.toISOString(),
        lastUsedAt: saved.lastUsedAt ? saved.lastUsedAt.toISOString() : null,
      },
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;

    if (err instanceof Error && err.message === "CHALLENGE_EXPIRED") {
      return NextResponse.json(
        { error: "Solicitação expirada. Tente cadastrar novamente." },
        { status: 400 }
      );
    }
    if (err instanceof Error && err.message === "VERIFICATION_FAILED") {
      return NextResponse.json(
        { error: "Não foi possível validar a biometria deste dispositivo." },
        { status: 400 }
      );
    }

    console.error("POST /api/security/webauthn/register/verify error:", err);
    return NextResponse.json(
      { error: "Erro ao concluir o cadastro de biometria." },
      { status: 500 }
    );
  }
}
