import { redirect } from "next/navigation";
import { hasValidUnlockCookie } from "@/lib/app-lock";
import { auth, signOut } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email.toLowerCase() },
    select: { id: true, appLockEnabled: true },
  });

  if (dbUser?.appLockEnabled) {
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
      appLockEnabled={Boolean(dbUser?.appLockEnabled)}
      signOutAction={handleSignOut}
    >
      {children}
    </AppShell>
  );
}
