import { redirect } from "next/navigation";
import { hasValidUnlockCookie } from "@/lib/app-lock";
import { getAuthenticatedSessionAndUser, signOut } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const resolved = await getAuthenticatedSessionAndUser();
  if (!resolved?.session?.user?.email) {
    redirect("/login");
  }

  const { session, dbUser } = resolved;

  if (dbUser.appLockEnabled) {
    const unlocked = await hasValidUnlockCookie(dbUser.id);
    if (!unlocked) {
      redirect("/unlock");
    }
  }

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <AppShell
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
      appLockEnabled={Boolean(dbUser.appLockEnabled)}
      signOutAction={handleSignOut}
    >
      {children}
    </AppShell>
  );
}
