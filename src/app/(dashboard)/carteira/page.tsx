import { requireUser } from "@/lib/auth";
import { loadCachedUserPortfolio } from "@/lib/portfolio-loader";
import { PortfolioManager } from "@/components/portfolio-manager";

export const dynamic = "force-dynamic";

export default async function CarteiraPage() {
  const user = await requireUser();
  const { summary } = await loadCachedUserPortfolio(user.id);

  return <PortfolioManager initialSummary={summary} />;
}
