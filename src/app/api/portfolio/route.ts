import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { loadUserPortfolio } from "@/lib/portfolio-loader";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const forceRefreshQuotes = searchParams.get("refresh") === "1";

    const data = await loadUserPortfolio(user.id, { forceRefreshQuotes });
    return NextResponse.json(data);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/portfolio error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar carteira" },
      { status: 500 }
    );
  }
}
