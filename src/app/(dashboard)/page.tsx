import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const { summary } = await loadCachedUserPortfolio(user.id);

  return <DashboardView initialSummary={summary} />;
}
