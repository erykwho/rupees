import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

export function isEmailAllowed(email?: string | null): boolean {
  if (!email) return false;
  const raw = process.env.ALLOWED_EMAILS?.trim();
  if (!raw) return false;
  const allowed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = Boolean(auth?.user?.email);
      const isLoginPage = nextUrl.pathname === "/login";
      const isAuthApi = nextUrl.pathname.startsWith("/api/auth");
      const isPublicAsset =
        nextUrl.pathname === "/manifest.webmanifest" ||
        nextUrl.pathname.startsWith("/icons/") ||
        nextUrl.pathname === "/favicon.ico";

      if (isAuthApi || isPublicAsset) {
        return true;
      }

      if (isLoginPage) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/", nextUrl));
        }
        return true;
      }

      return isLoggedIn;
    },
  },
};
