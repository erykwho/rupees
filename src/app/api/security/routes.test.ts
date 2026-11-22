import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireUserMock,
  requireAllowLockedMock,
  hasValidUnlockCookieMock,
  attachUnlockCookieMock,
  clearUnlockCookieMock,
  hashPinMock,
  verifyPinMock,
  prismaMock,
} = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  requireAllowLockedMock: vi.fn(),
  hasValidUnlockCookieMock: vi.fn(),
  attachUnlockCookieMock: vi.fn((res) => res),
  clearUnlockCookieMock: vi.fn((res) => res),
  hashPinMock: vi.fn(() => "hashed-pin"),
  verifyPinMock: vi.fn(),
  prismaMock: {
    user: { update: vi.fn() },
    webAuthnCredential: {
      count: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireUser: requireUserMock,
  requireAuthenticatedUserAllowLocked: requireAllowLockedMock,
  authErrorResponse: (err: unknown) => {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    if (err instanceof Error && err.message === "APP_LOCKED") {
      return NextResponse.json(
        { error: "Aplicativo bloqueado", code: "APP_LOCKED" },
        { status: 423 }
      );
    }
    return null;
  },
}));

vi.mock("@/lib/app-lock", () => ({
  hasValidUnlockCookie: hasValidUnlockCookieMock,
  attachUnlockCookie: attachUnlockCookieMock,
  clearUnlockCookie: clearUnlockCookieMock,
  hashPin: hashPinMock,
  verifyPin: verifyPinMock,
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { GET as getSecurityStatus } from "@/app/api/security/status/route";
import { PATCH as patchSecuritySettings } from "@/app/api/security/settings/route";
import { POST as postSecurityPin } from "@/app/api/security/pin/route";
import { POST as postUnlockPin } from "@/app/api/security/unlock/pin/route";
import { DELETE as deleteCredential } from "@/app/api/security/webauthn/credentials/[id]/route";

const USER_A = {
  id: "user-a",
  email: "a@example.com",
  appLockEnabled: true,
  appLockPinHash: "stored-hash",
  appLockTimeoutMinutes: 30,
  appLockRequirePinOnly: false,
  appLockFailedAttempts: 0,
  appLockLockedUntil: null as Date | null,
};

function jsonRequest(url: string, method: string, body: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("API /api/security/**", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue(USER_A);
    requireAllowLockedMock.mockResolvedValue(USER_A);
    hasValidUnlockCookieMock.mockResolvedValue(false);
    prismaMock.webAuthnCredential.count.mockResolvedValue(1);
  });

  it("retorna 401 quando não autenticado em todas as rotas de segurança", async () => {
    requireUserMock.mockRejectedValue(new Error("UNAUTHORIZED"));
    requireAllowLockedMock.mockRejectedValue(new Error("UNAUTHORIZED"));

    expect((await getSecurityStatus()).status).toBe(401);
    expect(
      (
        await patchSecuritySettings(
          jsonRequest("http://localhost/api/security/settings", "PATCH", {
            timeoutMinutes: 15,
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await postSecurityPin(
          jsonRequest("http://localhost/api/security/pin", "POST", {
            action: "enable",
            pin: "135790",
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await postUnlockPin(
          jsonRequest("http://localhost/api/security/unlock/pin", "POST", {
            pin: "135790",
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await deleteCredential(
          new Request("http://localhost/api/security/webauthn/credentials/c1", {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: "c1" }) }
        )
      ).status
    ).toBe(401);
  });

  it("exige app desbloqueado (423) para alterar settings, PIN ou remover credencial", async () => {
    requireUserMock.mockRejectedValue(new Error("APP_LOCKED"));

    expect(
      (
        await patchSecuritySettings(
          jsonRequest("http://localhost/api/security/settings", "PATCH", {
            timeoutMinutes: 15,
          })
        )
      ).status
    ).toBe(423);
    expect(
      (
        await deleteCredential(
          new Request("http://localhost/api/security/webauthn/credentials/c1", {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: "c1" }) }
        )
      ).status
    ).toBe(423);
  });

  it("bloqueia /api/security/unlock/pin com 429 durante período de lockout", async () => {
    requireAllowLockedMock.mockResolvedValue({
      ...USER_A,
      appLockLockedUntil: new Date(Date.now() + 60_000),
    });

    const res = await postUnlockPin(
      jsonRequest("http://localhost/api/security/unlock/pin", "POST", {
        pin: "135790",
      })
    );
    expect(res.status).toBe(429);
    expect(verifyPinMock).not.toHaveBeenCalled();
  });

  it("rejeita timeoutMinutes fora da allowlist em PATCH /api/security/settings (400)", async () => {
    const res = await patchSecuritySettings(
      jsonRequest("http://localhost/api/security/settings", "PATCH", {
        timeoutMinutes: 999,
      })
    );
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("retorna 404 ao tentar remover credencial WebAuthn de outro usuário (IDOR)", async () => {
    prismaMock.webAuthnCredential.findFirst.mockResolvedValue(null);

    const res = await deleteCredential(
      new Request(
        "http://localhost/api/security/webauthn/credentials/foreign-cred",
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: "foreign-cred" }) }
    );
    expect(res.status).toBe(404);
    expect(prismaMock.webAuthnCredential.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-cred", userId: USER_A.id },
      select: { id: true },
    });
    expect(prismaMock.webAuthnCredential.delete).not.toHaveBeenCalled();
  });
});
