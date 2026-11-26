import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { loadCachedUserSavingsSummary } from "@/lib/savings-loader";
import { loadCachedUserMonthlyBudgetHomeSummary } from "@/lib/monthly-budget-loader";
import { DashboardView } from "@/components/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const [{ summary }, savingsSummary, monthlySummary] = await Promise.all([
    loadCachedUserPortfolio(user.id),
    loadCachedUserSavingsSummary(user.id),
    loadCachedUserMonthlyBudgetHomeSummary(user.id),
  ]);

  return (
    <DashboardView
      initialSummary={summary}
      savingsSummary={savingsSummary}
      monthlySummary={monthlySummary}
    />
  );
}
