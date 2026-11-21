import { requireUser } from "@/lib/auth";
import { loadUserEvolution } from "@/lib/evolution-loader";
import { loadUserFixedIncome } from "@/lib/fixed-income-loader";
import { EvolutionView } from "@/components/evolution-view";

export const dynamic = "force-dynamic";

export default async function EvolutionPage() {
  const user = await requireUser();
  const [{ evolution }, fixedIncome] = await Promise.all([
    loadUserEvolution(user.id),
    loadUserFixedIncome(user.id),
  ]);

  return (
    <EvolutionView
      initialData={evolution}
      initialFixedIncome={fixedIncome}
    />
  );
}
