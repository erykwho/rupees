import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { ContributionPlanner } from "@/components/contribution-planner";

export const dynamic = "force-dynamic";

export default async function AportePage(props: {
  searchParams?: Promise<{ valor?: string }>;
}) {
  const user = await requireUser();
  const [{ summary }, resolvedParams] = await Promise.all([
    loadCachedUserPortfolio(user.id),
    props.searchParams ?? Promise.resolve<{ valor?: string }>({}),
  ]);

  const rawValor = resolvedParams?.valor?.replace(",", ".");
  const parsedValor = rawValor ? Number(rawValor) : NaN;
  const initialAmountBRL =
    Number.isFinite(parsedValor) && parsedValor > 0 ? parsedValor : undefined;

  return (
    <ContributionPlanner
      initialSummary={summary}
      initialAmountBRL={initialAmountBRL}
    />
  );
}
