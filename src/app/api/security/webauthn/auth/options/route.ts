import { NextResponse } from "next/server";
import {
  authErrorResponse,
  requireAuthenticatedUserAllowLocked,
} from "@/lib/auth";
import { createWebAuthnAuthenticationOptions } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUserAllowLocked();

    if (!user.appLockEnabled) {
      return NextResponse.json(
        { error: "O bloqueio do aplicativo não está ativado." },
        { status: 400 }
      );
    }

    if (user.appLockRequirePinOnly) {
      return NextResponse.json(
        { error: "O modo 'Exigir PIN sempre' está ativo." },
        { status: 403 }
      );
    }

    const options = await createWebAuthnAuthenticationOptions(user, request);
    return NextResponse.json({ options });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;

    if (err instanceof Error && err.message === "NO_CREDENTIALS") {
      return NextResponse.json(
        { error: "Nenhuma biometria cadastrada para esta conta." },
        { status: 400 }
      );
    }

    console.error("POST /api/security/webauthn/auth/options error:", err);
    return NextResponse.json(
      { error: "Não foi possível iniciar a validação biométrica." },
      { status: 500 }
    );
  }
}
