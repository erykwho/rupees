export const APP_LOCK_COOKIE_NAME = "rupees_unlock";

export const APP_LOCK_TIMEOUT_OPTIONS = [5, 15, 30, 60, 240] as const;
export type AppLockTimeoutMinutes = (typeof APP_LOCK_TIMEOUT_OPTIONS)[number];

export const DEFAULT_APP_LOCK_TIMEOUT_MINUTES: AppLockTimeoutMinutes = 30;
export const UNLOCK_TOKEN_REFRESH_THRESHOLD_SECONDS = 60;

export const APP_LOCK_TIMEOUT_LABELS: Record<AppLockTimeoutMinutes, string> = {
  5: "5 minutos",
  15: "15 minutos",
  30: "30 minutos",
  60: "1 hora",
  240: "4 horas",
};

export interface UnlockTokenPayload {
  uid: string;
  iat: number;
  exp: number;
  ttl: number;
}

export function isValidTimeoutMinutes(
  value: number
): value is AppLockTimeoutMinutes {
  return (APP_LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(value);
}

export function normalizeTimeoutMinutes(
  value: number | null | undefined
): AppLockTimeoutMinutes {
  if (typeof value === "number" && isValidTimeoutMinutes(value)) {
    return value;
  }
  return DEFAULT_APP_LOCK_TIMEOUT_MINUTES;
}

export function validatePinFormat(pin: string): {
  valid: boolean;
  error?: string;
} {
  if (!/^\d{6}$/.test(pin)) {
    return {
      valid: false,
      error: "O PIN deve conter exatamente 6 dígitos numéricos.",
    };
  }
  return { valid: true };
}

/**
 * Progressive backoff duration (in seconds) after consecutive failed PIN attempts.
 */
export function computeLockoutDurationSeconds(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  if (failedAttempts < 8) return 60; // 1 minuto
  if (failedAttempts < 10) return 300; // 5 minutos
  return 900; // 15 minutos
}

export function getRemainingLockoutSeconds(
  lockedUntil: Date | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!lockedUntil) return 0;
  const diffMs = lockedUntil.getTime() - nowMs;
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / 1000);
}

export function isUnlockTokenValid(
  payload: UnlockTokenPayload | null | undefined,
  expectedUserId: string,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  if (!payload) return false;
  if (!expectedUserId || payload.uid !== expectedUserId) return false;
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSec) return false;
  if (!Number.isFinite(payload.ttl) || payload.ttl <= 0) return false;
  return true;
}

export function shouldRefreshUnlockToken(
  payload: UnlockTokenPayload,
  nowSec: number = Math.floor(Date.now() / 1000)
): boolean {
  return nowSec - payload.iat >= UNLOCK_TOKEN_REFRESH_THRESHOLD_SECONDS;
}

/**
 * Sanitizes post-unlock redirect paths to prevent open redirects.
 */
export function sanitizeUnlockRedirectPath(nextPath: string | null | undefined): string {
  if (!nextPath || typeof nextPath !== "string") return "/";
  const trimmed = nextPath.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return "/";
  if (trimmed.startsWith("/unlock") || trimmed.startsWith("/login")) return "/";
  return trimmed;
}
