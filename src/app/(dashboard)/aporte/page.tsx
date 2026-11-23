import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { ContributionPlanner } from "@/components/contribution-planner";

export const dynamic = "force-dynamic";

export default async function AportePage() {
  const user = await requireUser();
  const { summary } = await loadCachedUserPortfolio(user.id);

  return <ContributionPlanner initialSummary={summary} />;
}
