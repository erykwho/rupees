import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { loadUserFixedIncome } from "@/lib/fixed-income-loader";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const data = await loadUserFixedIncome(user.id, {
      forceRefreshBenchmarks: forceRefresh,
    });

    return NextResponse.json(data);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/fixed-income error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar projeção de renda fixa" },
      { status: 500 }
    );
  }
}
