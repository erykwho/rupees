import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const RP_NAME = "Rupees";
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutos

export interface WebAuthnContext {
  rpID: string;
  origin: string;
}

export function resolveWebAuthnContext(request: Request): WebAuthnContext {
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      return {
        rpID: parsed.hostname,
        origin: parsed.origin,
      };
    } catch {
      // fallback abaixo
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = (forwardedHost || request.headers.get("host") || "localhost:3000")
    .split(",")[0]
    .trim();
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto =
    forwardedProto?.split(",")[0].trim() ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  const url = new URL(`${proto}://${host}`);
  return {
    rpID: url.hostname,
    origin: url.origin,
  };
}

function parseTransports(
  raw: string | null | undefined
): AuthenticatorTransport[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is AuthenticatorTransport =>
        typeof item === "string"
      );
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function createWebAuthnRegistrationOptions(
  user: Pick<User, "id" | "email" | "name">,
  request: Request
) {
  const { rpID } = resolveWebAuthnContext(request);
  const existingCredentials = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.email,
    userDisplayName: user.name ?? user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existingCredentials.map((cred) => ({
      id: cred.credentialId,
      transports: parseTransports(cred.transports),
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await prisma.securityChallenge.deleteMany({
    where: { userId: user.id, type: "registration" },
  });

  await prisma.securityChallenge.create({
    data: {
      userId: user.id,
      challenge: options.challenge,
      type: "registration",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export async function verifyAndSaveWebAuthnRegistration(
  user: Pick<User, "id">,
  response: RegistrationResponseJSON,
  deviceName: string,
  request: Request
) {
  const { rpID, origin } = resolveWebAuthnContext(request);

  const challengeRecord = await prisma.securityChallenge.findFirst({
    where: {
      userId: user.id,
      type: "registration",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challengeRecord) {
    throw new Error("CHALLENGE_EXPIRED");
  }

  // Consome o challenge imediatamente para evitar replay
  await prisma.securityChallenge.deleteMany({
    where: { userId: user.id, type: "registration" },
  });

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("VERIFICATION_FAILED");
  }

  const { credential } = verification.registrationInfo;
  const cleanDeviceName = deviceName.trim().slice(0, 60) || "Dispositivo atual";

  const saved = await prisma.webAuthnCredential.upsert({
    where: { credentialId: credential.id },
    update: {
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports
        ? JSON.stringify(credential.transports)
        : null,
      deviceName: cleanDeviceName,
      lastUsedAt: new Date(),
    },
    create: {
      userId: user.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      transports: credential.transports
        ? JSON.stringify(credential.transports)
        : null,
      deviceName: cleanDeviceName,
      lastUsedAt: new Date(),
    },
  });

  return saved;
}

export async function createWebAuthnAuthenticationOptions(
  user: Pick<User, "id">,
  request: Request
) {
  const { rpID } = resolveWebAuthnContext(request);
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    select: { credentialId: true, transports: true },
  });

  if (credentials.length === 0) {
    throw new Error("NO_CREDENTIALS");
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((cred) => ({
      id: cred.credentialId,
      transports: parseTransports(cred.transports),
    })),
  });

  await prisma.securityChallenge.deleteMany({
    where: { userId: user.id, type: "authentication" },
  });

  await prisma.securityChallenge.create({
    data: {
      userId: user.id,
      challenge: options.challenge,
      type: "authentication",
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });

  return options;
}

export async function verifyWebAuthnAuthentication(
  user: Pick<User, "id">,
  response: AuthenticationResponseJSON,
  request: Request
) {
  const { rpID, origin } = resolveWebAuthnContext(request);

  const challengeRecord = await prisma.securityChallenge.findFirst({
    where: {
      userId: user.id,
      type: "authentication",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!challengeRecord) {
    throw new Error("CHALLENGE_EXPIRED");
  }

  await prisma.securityChallenge.deleteMany({
    where: { userId: user.id, type: "authentication" },
  });

  const stored = await prisma.webAuthnCredential.findFirst({
    where: {
      userId: user.id,
      credentialId: response.id,
    },
  });

  if (!stored) {
    throw new Error("CREDENTIAL_NOT_FOUND");
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challengeRecord.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(Buffer.from(stored.publicKey, "base64url")),
      counter: stored.counter,
      transports: parseTransports(stored.transports),
    },
  });

  if (!verification.verified) {
    throw new Error("VERIFICATION_FAILED");
  }

  await prisma.webAuthnCredential.update({
    where: { id: stored.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  return stored;
}
