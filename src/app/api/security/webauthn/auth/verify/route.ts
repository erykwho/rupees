import { NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { attachUnlockCookie } from "@/lib/app-lock";
import {
  authErrorResponse,
  requireAuthenticatedUserAllowLocked,
} from "@/lib/auth";
import { normalizeTimeoutMinutes } from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";
import { verifyWebAuthnAuthentication } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUserAllowLocked();

    if (!user.appLockEnabled) {
      return NextResponse.json({ ok: true });
    }

    if (user.appLockRequirePinOnly) {
      return NextResponse.json(
        { error: "O modo 'Exigir PIN sempre' está ativo. Use seu PIN." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      response?: AuthenticationResponseJSON;
    };

    if (!body?.response || typeof body.response !== "object") {
      return NextResponse.json(
        { error: "Resposta biométrica inválida." },
        { status: 400 }
      );
    }

    await verifyWebAuthnAuthentication(user, body.response, request);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        appLockFailedAttempts: 0,
        appLockLockedUntil: null,
      },
    });

    const timeoutMinutes = normalizeTimeoutMinutes(user.appLockTimeoutMinutes);
    const response = NextResponse.json({ ok: true });
    return attachUnlockCookie(response, user.id, timeoutMinutes);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;

    if (
      err instanceof Error &&
      (err.message === "CHALLENGE_EXPIRED" ||
        err.message === "CREDENTIAL_NOT_FOUND" ||
        err.message === "VERIFICATION_FAILED")
    ) {
      return NextResponse.json(
        { error: "Não foi possível validar a biometria. Tente novamente ou use o PIN." },
        { status: 401 }
      );
    }

    console.error("POST /api/security/webauthn/auth/verify error:", err);
    return NextResponse.json(
      { error: "Erro ao validar a biometria." },
      { status: 500 }
    );
  }
}
