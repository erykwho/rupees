import { requireUser } from "@/lib/auth";
import { loadCachedUserSavingsSummary } from "@/lib/savings-loader";
import { SavingsView } from "@/components/savings-view";

export const dynamic = "force-dynamic";

export default async function CaixinhasPage() {
  const user = await requireUser();
  const summary = await loadCachedUserSavingsSummary(user.id);

  return <SavingsView initialSummary={summary} />;
}
