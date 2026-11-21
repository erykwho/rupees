import { NextResponse } from "next/server";
import { z } from "zod";
import { attachUnlockCookie, verifyPin } from "@/lib/app-lock";
import {
  authErrorResponse,
  requireAuthenticatedUserAllowLocked,
} from "@/lib/auth";
import {
  computeLockoutDurationSeconds,
  getRemainingLockoutSeconds,
  normalizeTimeoutMinutes,
  validatePinFormat,
} from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";

const unlockPinSchema = z.object({
  pin: z.string(),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthenticatedUserAllowLocked();

    if (!user.appLockEnabled || !user.appLockPinHash) {
      return NextResponse.json({ ok: true });
    }

    const remainingBefore = getRemainingLockoutSeconds(user.appLockLockedUntil);
    if (remainingBefore > 0) {
      return NextResponse.json(
        {
          error: `Muitas tentativas incorretas. Tente novamente em ${remainingBefore}s.`,
          remainingLockoutSeconds: remainingBefore,
          lockedUntil: user.appLockLockedUntil?.toISOString() ?? null,
        },
        { status: 429 }
      );
    }

    const body = await request.json();
    const parsed = unlockPinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Informe o PIN de 6 dígitos." },
        { status: 400 }
      );
    }

    const format = validatePinFormat(parsed.data.pin);
    if (!format.valid) {
      return NextResponse.json({ error: format.error }, { status: 400 });
    }

    const valid = verifyPin(parsed.data.pin, user.appLockPinHash);

    if (!valid) {
      const nextAttempts = user.appLockFailedAttempts + 1;
      const lockoutSeconds = computeLockoutDurationSeconds(nextAttempts);
      const lockedUntil =
        lockoutSeconds > 0 ? new Date(Date.now() + lockoutSeconds * 1000) : null;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          appLockFailedAttempts: nextAttempts,
          appLockLockedUntil: lockedUntil,
        },
      });

      if (lockoutSeconds > 0) {
        return NextResponse.json(
          {
            error: `PIN incorreto. Bloqueado temporariamente por ${Math.ceil(lockoutSeconds / 60)} min.`,
            remainingLockoutSeconds: lockoutSeconds,
            lockedUntil: lockedUntil?.toISOString() ?? null,
          },
          { status: 429 }
        );
      }

      const attemptsLeft = Math.max(0, 5 - nextAttempts);
      return NextResponse.json(
        {
          error:
            attemptsLeft > 0
              ? `PIN incorreto. Restam ${attemptsLeft} tentativa(s) antes do bloqueio temporário.`
              : "PIN incorreto.",
          remainingLockoutSeconds: 0,
        },
        { status: 401 }
      );
    }

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
    console.error("POST /api/security/unlock/pin error:", err);
    return NextResponse.json(
      { error: "Erro ao validar o PIN." },
      { status: 500 }
    );
  }
}
