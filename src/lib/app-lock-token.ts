import {
  APP_LOCK_COOKIE_NAME,
  normalizeTimeoutMinutes,
  type UnlockTokenPayload,
} from "./domain/security";

export { APP_LOCK_COOKIE_NAME };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function getSigningSecret(): string {
  const secret =
    process.env.AUTH_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET não configurada para assinar o cookie de bloqueio.");
  }
  return `rupees-app-lock-v1:${secret}`;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(base64url: string): Uint8Array | null {
  try {
    const padded = base64url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(base64url.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signUnlockToken(
  userId: string,
  timeoutMinutes: number,
  options?: { nowSec?: number; secret?: string }
): Promise<{ token: string; payload: UnlockTokenPayload }> {
  const ttl = normalizeTimeoutMinutes(timeoutMinutes);
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const payload: UnlockTokenPayload = {
    uid: userId,
    iat: nowSec,
    exp: nowSec + ttl * 60,
    ttl,
  };

  const encodedPayload = bytesToBase64Url(
    textEncoder.encode(JSON.stringify(payload))
  );
  const key = await importHmacKey(options?.secret ?? getSigningSecret());
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(encodedPayload)
  );
  const encodedSig = bytesToBase64Url(new Uint8Array(sigBuffer));

  return {
    token: `${encodedPayload}.${encodedSig}`,
    payload,
  };
}

export async function verifyUnlockToken(
  token: string | undefined | null,
  options?: { secret?: string }
): Promise<UnlockTokenPayload | null> {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encodedPayload, encodedSig] = parts;
  if (!encodedPayload || !encodedSig) return null;

  const sigBytes = base64UrlToBytes(encodedSig);
  if (!sigBytes) return null;

  try {
    const key = await importHmacKey(options?.secret ?? getSigningSecret());
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      textEncoder.encode(encodedPayload)
    );
    if (!valid) return null;

    const payloadBytes = base64UrlToBytes(encodedPayload);
    if (!payloadBytes) return null;

    const parsed = JSON.parse(textDecoder.decode(payloadBytes)) as Partial<UnlockTokenPayload>;
    if (
      typeof parsed.uid !== "string" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number" ||
      typeof parsed.ttl !== "number"
    ) {
      return null;
    }

    return {
      uid: parsed.uid,
      iat: parsed.iat,
      exp: parsed.exp,
      ttl: parsed.ttl,
    };
  } catch {
    return null;
  }
}

export function buildUnlockCookieOptions(timeoutMinutes: number) {
  const ttl = normalizeTimeoutMinutes(timeoutMinutes);
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: ttl * 60,
  };
}
