import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { createWebAuthnRegistrationOptions } from "@/lib/webauthn";

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    if (!user.appLockEnabled) {
      return NextResponse.json(
        { error: "Ative o PIN de 6 dígitos antes de cadastrar a biometria." },
        { status: 400 }
      );
    }

    const options = await createWebAuthnRegistrationOptions(user, request);
    return NextResponse.json({ options });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("POST /api/security/webauthn/register/options error:", err);
    return NextResponse.json(
      { error: "Não foi possível iniciar o cadastro de biometria." },
      { status: 500 }
    );
  }
}
