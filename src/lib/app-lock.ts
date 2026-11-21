import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import {
  APP_LOCK_COOKIE_NAME,
  buildUnlockCookieOptions,
  signUnlockToken,
  verifyUnlockToken,
} from "./app-lock-token";
import { isUnlockTokenValid } from "./domain/security";

const SCRYPT_KEYLEN = 64;

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(pin, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPin(pin: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || typeof storedHash !== "string") return false;
  const parts = storedHash.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  const [, salt, hashHex] = parts;
  if (!salt || !hashHex) return false;

  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(pin, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function hasValidUnlockCookie(userId: string): Promise<boolean> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(APP_LOCK_COOKIE_NAME)?.value;
  const payload = await verifyUnlockToken(raw);
  return isUnlockTokenValid(payload, userId);
}

export async function attachUnlockCookie(
  response: NextResponse,
  userId: string,
  timeoutMinutes: number
): Promise<NextResponse> {
  const { token, payload } = await signUnlockToken(userId, timeoutMinutes);
  response.cookies.set(
    APP_LOCK_COOKIE_NAME,
    token,
    buildUnlockCookieOptions(payload.ttl)
  );
  return response;
}

export function clearUnlockCookie(response: NextResponse): NextResponse {
  response.cookies.set(APP_LOCK_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
