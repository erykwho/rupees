import { NextResponse } from "next/server";
import { hasValidUnlockCookie } from "@/lib/app-lock";
import {
  authErrorResponse,
  requireAuthenticatedUserAllowLocked,
} from "@/lib/auth";
import {
  getRemainingLockoutSeconds,
  normalizeTimeoutMinutes,
} from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireAuthenticatedUserAllowLocked();
    const credentialsCount = await prisma.webAuthnCredential.count({
      where: { userId: user.id },
    });

    const unlocked = user.appLockEnabled
      ? await hasValidUnlockCookie(user.id)
      : true;
    const remainingLockoutSeconds = getRemainingLockoutSeconds(
      user.appLockLockedUntil
    );

    return NextResponse.json({
      enabled: user.appLockEnabled,
      unlocked,
      timeoutMinutes: normalizeTimeoutMinutes(user.appLockTimeoutMinutes),
      requirePinOnly: user.appLockRequirePinOnly,
      hasBiometrics: credentialsCount > 0,
      credentialsCount,
      remainingLockoutSeconds,
      lockedUntil:
        remainingLockoutSeconds > 0 && user.appLockLockedUntil
          ? user.appLockLockedUntil.toISOString()
          : null,
    });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/security/status error:", err);
    return NextResponse.json(
      { error: "Erro ao consultar status de segurança." },
      { status: 500 }
    );
  }
}
