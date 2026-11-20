import { requireUser } from "@/lib/auth";
import { loadUserPortfolio } from "@/lib/portfolio-loader";
import { ContributionPlanner } from "@/components/contribution-planner";

export const dynamic = "force-dynamic";

export default async function AportePage() {
  const user = await requireUser();
  const { summary } = await loadUserPortfolio(user.id);

  return <ContributionPlanner initialSummary={summary} />;
}
