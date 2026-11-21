import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadUserEvolution } from "@/lib/evolution-loader";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const data = await loadUserEvolution(user.id, { forceRefresh });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error("GET /api/evolution error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar evolução patrimonial" },
      { status: 500 }
    );
  }
}
