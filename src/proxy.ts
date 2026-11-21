import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";
import {
  APP_LOCK_COOKIE_NAME,
  buildUnlockCookieOptions,
  signUnlockToken,
  verifyUnlockToken,
} from "@/lib/app-lock-token";
import {
  isUnlockTokenValid,
  shouldRefreshUnlockToken,
} from "@/lib/domain/security";

const { auth } = NextAuth(authConfig);

export const proxy = auth(async (req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  const isAuthApi = pathname.startsWith("/api/auth");
  const isPublicAsset =
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico";

  if (isAuthApi || isPublicAsset) {
    return NextResponse.next();
  }

  const userEmail = req.auth?.user?.email;
  const userId = req.auth?.user?.id;
  const appLockEnabled = Boolean(req.auth?.user?.appLockEnabled);
  const isLoggedIn = Boolean(userEmail);
  const isLoginPage = pathname === "/login";
  const isUnlockPage = pathname === "/unlock";
  const isApiRoute = pathname.startsWith("/api/");
  const isSecurityApi = pathname.startsWith("/api/security/");

  if (!isLoggedIn) {
    if (isLoginPage) {
      return NextResponse.next();
    }
    if (isApiRoute) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (isLoginPage) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // Valida cookie de desbloqueio (quando presente) e aplica sliding timeout
  const rawUnlockCookie = req.cookies.get(APP_LOCK_COOKIE_NAME)?.value;
  const unlockPayload = rawUnlockCookie
    ? await verifyUnlockToken(rawUnlockCookie)
    : null;
  const isUnlocked = Boolean(
    userId && isUnlockTokenValid(unlockPayload, userId)
  );

  if (appLockEnabled) {
    if (isUnlockPage) {
      if (isUnlocked) {
        return NextResponse.redirect(new URL("/", nextUrl));
      }
      return NextResponse.next();
    }

    if (!isUnlocked && !isSecurityApi) {
      if (isApiRoute) {
        return NextResponse.json(
          {
            error: "Aplicativo bloqueado. Desbloqueie para continuar.",
            code: "APP_LOCKED",
          },
          { status: 423 }
        );
      }
      const unlockUrl = new URL("/unlock", nextUrl);
      const target = `${pathname}${nextUrl.search}`;
      if (target && target !== "/") {
        unlockUrl.searchParams.set("next", target);
      }
      return NextResponse.redirect(unlockUrl);
    }
  }

  const response = NextResponse.next();

  // Renova o cookie de desbloqueio em janela deslizante (com throttle de 60s)
  if (
    isUnlocked &&
    userId &&
    unlockPayload &&
    shouldRefreshUnlockToken(unlockPayload)
  ) {
    const { token } = await signUnlockToken(userId, unlockPayload.ttl);
    response.cookies.set(
      APP_LOCK_COOKIE_NAME,
      token,
      buildUnlockCookieOptions(unlockPayload.ttl)
    );
  }

  return response;
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)",
  ],
};
