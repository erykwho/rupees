import { requireUser } from "@/lib/auth";
import { normalizeTimeoutMinutes } from "@/lib/domain/security";
import { prisma } from "@/lib/prisma";
import { SecuritySettings } from "@/components/security-settings";

export default async function SecurityPage() {
  const user = await requireUser();
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      deviceName: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return (
    <SecuritySettings
      initialEnabled={user.appLockEnabled}
      initialTimeoutMinutes={normalizeTimeoutMinutes(user.appLockTimeoutMinutes)}
      initialRequirePinOnly={user.appLockRequirePinOnly}
      initialCredentials={credentials.map((cred) => ({
        id: cred.id,
        deviceName: cred.deviceName,
        createdAt: cred.createdAt.toISOString(),
        lastUsedAt: cred.lastUsedAt ? cred.lastUsedAt.toISOString() : null,
      }))}
    />
  );
}
