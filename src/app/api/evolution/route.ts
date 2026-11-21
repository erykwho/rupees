import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { loadUserEvolution } from "@/lib/evolution-loader";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "1";

    const data = await loadUserEvolution(user.id, { forceRefresh });
    return NextResponse.json(data);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/evolution error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar evolução patrimonial" },
      { status: 500 }
    );
  }
}
