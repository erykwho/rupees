import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { GoalsEditor } from "@/components/goals-editor";

export const dynamic = "force-dynamic";

export default async function ObjetivosPage() {
  const user = await requireUser();
  const { goal, summary } = await loadCachedUserPortfolio(user.id);

  return <GoalsEditor initialGoal={goal} summary={summary} />;
}
