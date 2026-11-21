import { NextResponse } from "next/server";
import { z } from "zod";
import {
  attachUnlockCookie,
  clearUnlockCookie,
  hashPin,
  verifyPin,
} from "@/lib/app-lock";
import { authErrorResponse, requireUser } from "@/lib/auth";
import {
  normalizeTimeoutMinutes,
  validatePinFormat,
} from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";

const enablePinSchema = z.object({
  action: z.literal("enable"),
  pin: z.string(),
  timeoutMinutes: z.number().int().optional(),
});

const changePinSchema = z.object({
  action: z.literal("change"),
  currentPin: z.string(),
  newPin: z.string(),
});

const disablePinSchema = z.object({
  action: z.literal("disable"),
  currentPin: z.string(),
});

const pinActionSchema = z.discriminatedUnion("action", [
  enablePinSchema,
  changePinSchema,
  disablePinSchema,
]);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = pinActionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dados inválidos para configuração de PIN." },
        { status: 400 }
      );
    }

    const input = parsed.data;

    if (input.action === "enable") {
      if (user.appLockEnabled) {
        return NextResponse.json(
          { error: "O bloqueio do aplicativo já está ativado." },
          { status: 400 }
        );
      }

      const format = validatePinFormat(input.pin);
      if (!format.valid) {
        return NextResponse.json({ error: format.error }, { status: 400 });
      }

      const timeoutMinutes = normalizeTimeoutMinutes(
        input.timeoutMinutes ?? user.appLockTimeoutMinutes
      );

      await prisma.user.update({
        where: { id: user.id },
        data: {
          appLockEnabled: true,
          appLockPinHash: hashPin(input.pin),
          appLockTimeoutMinutes: timeoutMinutes,
          appLockFailedAttempts: 0,
          appLockLockedUntil: null,
        },
      });

      const response = NextResponse.json({
        ok: true,
        enabled: true,
        timeoutMinutes,
      });
      return attachUnlockCookie(response, user.id, timeoutMinutes);
    }

    if (!user.appLockEnabled || !user.appLockPinHash) {
      return NextResponse.json(
        { error: "O bloqueio do aplicativo não está ativado." },
        { status: 400 }
      );
    }

    if (!verifyPin(input.currentPin, user.appLockPinHash)) {
      return NextResponse.json(
        { error: "PIN atual incorreto." },
        { status: 400 }
      );
    }

    if (input.action === "change") {
      const format = validatePinFormat(input.newPin);
      if (!format.valid) {
        return NextResponse.json({ error: format.error }, { status: 400 });
      }

      if (input.currentPin === input.newPin) {
        return NextResponse.json(
          { error: "O novo PIN deve ser diferente do PIN atual." },
          { status: 400 }
        );
      }

      const timeoutMinutes = normalizeTimeoutMinutes(user.appLockTimeoutMinutes);

      await prisma.user.update({
        where: { id: user.id },
        data: {
          appLockPinHash: hashPin(input.newPin),
          appLockFailedAttempts: 0,
          appLockLockedUntil: null,
        },
      });

      const response = NextResponse.json({ ok: true, enabled: true });
      return attachUnlockCookie(response, user.id, timeoutMinutes);
    }

    // action === "disable"
    await prisma.user.update({
      where: { id: user.id },
      data: {
        appLockEnabled: false,
        appLockPinHash: null,
        appLockRequirePinOnly: false,
        appLockFailedAttempts: 0,
        appLockLockedUntil: null,
      },
    });

    const response = NextResponse.json({ ok: true, enabled: false });
    return clearUnlockCookie(response);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("POST /api/security/pin error:", err);
    return NextResponse.json(
      { error: "Erro ao atualizar configuração de PIN." },
      { status: 500 }
    );
  }
}
