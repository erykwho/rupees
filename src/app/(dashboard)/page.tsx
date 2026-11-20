import { requireUser } from "@/lib/auth";
import { loadUserPortfolio } from "@/lib/portfolio-loader";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const { summary } = await loadUserPortfolio(user.id);

  return <DashboardView initialSummary={summary} />;
}
