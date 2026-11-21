import { NextResponse } from "next/server";
import { z } from "zod";
import { attachUnlockCookie } from "@/lib/app-lock";
import { authErrorResponse, requireUser } from "@/lib/auth";
import {
  isValidTimeoutMinutes,
  normalizeTimeoutMinutes,
} from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";

const settingsSchema = z.object({
  timeoutMinutes: z.number().int().optional(),
  requirePinOnly: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const parsed = settingsSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Configurações inválidas." },
        { status: 400 }
      );
    }

    const { timeoutMinutes, requirePinOnly } = parsed.data;
    if (timeoutMinutes !== undefined && !isValidTimeoutMinutes(timeoutMinutes)) {
      return NextResponse.json(
        { error: "Tempo de inatividade não suportado." },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(timeoutMinutes !== undefined
          ? { appLockTimeoutMinutes: timeoutMinutes }
          : {}),
        ...(requirePinOnly !== undefined
          ? { appLockRequirePinOnly: requirePinOnly }
          : {}),
      },
      select: {
        appLockEnabled: true,
        appLockTimeoutMinutes: true,
        appLockRequirePinOnly: true,
      },
    });

    const normalizedTimeout = normalizeTimeoutMinutes(
      updated.appLockTimeoutMinutes
    );

    const response = NextResponse.json({
      ok: true,
      timeoutMinutes: normalizedTimeout,
      requirePinOnly: updated.appLockRequirePinOnly,
    });

    if (updated.appLockEnabled) {
      return attachUnlockCookie(response, user.id, normalizedTimeout);
    }

    return response;
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("PATCH /api/security/settings error:", err);
    return NextResponse.json(
      { error: "Erro ao salvar preferências de segurança." },
      { status: 500 }
    );
  }
}
