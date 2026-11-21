import { redirect } from "next/navigation";
import { hasValidUnlockCookie } from "@/lib/app-lock";
import { auth, signOut } from "@/lib/auth";
import {
  getRemainingLockoutSeconds,
  sanitizeUnlockRedirectPath,
} from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";
import { UnlockScreen } from "@/components/unlock-screen";

export default async function UnlockPage(props: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }

  const searchParams = await props.searchParams;
  const nextPath = sanitizeUnlockRedirectPath(searchParams.next);

  const dbUser = await prisma.user.findUnique({
    where: { email: session.user.email.toLowerCase() },
    select: {
      id: true,
      name: true,
      email: true,
      appLockEnabled: true,
      appLockRequirePinOnly: true,
      appLockLockedUntil: true,
      _count: {
        select: { webAuthnCredentials: true },
      },
    },
  });

  if (!dbUser?.appLockEnabled) {
    redirect(nextPath);
  }

  const unlocked = await hasValidUnlockCookie(dbUser.id);
  if (unlocked) {
    redirect(nextPath);
  }

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  const canUseBiometrics =
    dbUser._count.webAuthnCredentials > 0 && !dbUser.appLockRequirePinOnly;
  const initialLockoutSeconds = getRemainingLockoutSeconds(
    dbUser.appLockLockedUntil
  );

  return (
    <UnlockScreen
      userName={dbUser.name}
      userEmail={dbUser.email}
      nextPath={nextPath}
      canUseBiometrics={canUseBiometrics}
      initialLockoutSeconds={initialLockoutSeconds}
      signOutAction={handleSignOut}
    />
  );
}
