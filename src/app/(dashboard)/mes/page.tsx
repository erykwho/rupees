import { requireUser } from "@/lib/auth";
import { loadUserMonthlyBudgetPageData } from "@/lib/monthly-budget-loader";
import { MonthlyBudgetView } from "@/components/monthly-budget-view";

export const dynamic = "force-dynamic";

export default async function MesPage(props: {
  searchParams?: Promise<{ year?: string; month?: string }>;
}) {
  const user = await requireUser();
  const resolved = await (props.searchParams ??
    Promise.resolve<{ year?: string; month?: string }>({}));

  const rawYear = resolved.year ? Number(resolved.year) : undefined;
  const rawMonth = resolved.month ? Number(resolved.month) : undefined;
  const year =
    rawYear !== undefined && Number.isInteger(rawYear) && rawYear >= 2020 && rawYear <= 2100
      ? rawYear
      : undefined;
  const month =
    rawMonth !== undefined && Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12
      ? rawMonth
      : undefined;

  const initialData = await loadUserMonthlyBudgetPageData(user.id, {
    year,
    month,
  });

  return <MonthlyBudgetView initialData={initialData} />;
}
