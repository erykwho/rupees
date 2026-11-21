import { requireUser } from "@/lib/auth";
import { loadUserEvolution } from "@/lib/evolution-loader";
import { EvolutionView } from "@/components/evolution-view";

export const dynamic = "force-dynamic";

export default async function EvolutionPage() {
  const user = await requireUser();
  const { evolution } = await loadUserEvolution(user.id);

  return <EvolutionView initialData={evolution} />;
}
