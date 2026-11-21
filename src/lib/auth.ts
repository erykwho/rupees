import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig, isEmailAllowed } from "@/auth.config";
import { hasValidUnlockCookie } from "@/lib/app-lock";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      if (!isEmailAllowed(user.email)) {
        return false;
      }

      const email = user.email!.toLowerCase();
      const dbUser = await prisma.user.upsert({
        where: { email },
        update: {
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        },
        create: {
          email,
          name: user.name ?? null,
          image: user.image ?? null,
        },
      });

      await prisma.allocationGoal.upsert({
        where: { userId: dbUser.id },
        update: {},
        create: {
          userId: dbUser.id,
        },
      });

      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { id: true, appLockEnabled: true },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.appLockEnabled = dbUser.appLockEnabled;
        }
      } else if (
        trigger === "update" &&
        session &&
        typeof (session as { appLockEnabled?: unknown }).appLockEnabled ===
          "boolean"
      ) {
        token.appLockEnabled = (
          session as { appLockEnabled: boolean }
        ).appLockEnabled;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      if (session.user && typeof token.appLockEnabled === "boolean") {
        session.user.appLockEnabled = token.appLockEnabled;
      }
      return session;
    },
  },
});

async function resolveAuthenticatedUser() {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase();
  if (!email) {
    throw new Error("UNAUTHORIZED");
  }

  let dbUser = await prisma.user.findUnique({
    where: { email },
  });

  if (!dbUser) {
    dbUser = await prisma.user.create({
      data: {
        email,
        name: session?.user?.name ?? null,
        image: session?.user?.image ?? null,
        goal: { create: {} },
      },
    });
  }

  return dbUser;
}

/**
 * Requires an authenticated Google session AND, if App Lock is enabled,
 * a valid server-signed unlock cookie.
 */
export async function requireUser() {
  const dbUser = await resolveAuthenticatedUser();

  if (dbUser.appLockEnabled) {
    const unlocked = await hasValidUnlockCookie(dbUser.id);
    if (!unlocked) {
      throw new Error("APP_LOCKED");
    }
  }

  return dbUser;
}

/**
 * Requires an authenticated Google session, allowing locked state.
 * Use ONLY in unlock/status security endpoints.
 */
export async function requireAuthenticatedUserAllowLocked() {
  return resolveAuthenticatedUser();
}

export function authErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof Error)) return null;
  if (err.message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (err.message === "APP_LOCKED") {
    return NextResponse.json(
      { error: "Aplicativo bloqueado. Desbloqueie para continuar.", code: "APP_LOCKED" },
      { status: 423 }
    );
  }
  return null;
}
