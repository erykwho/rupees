import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { loadUserSavingsSummary } from "@/lib/savings-loader";

export async function GET() {
  try {
    const user = await requireUser();
    const summary = await loadUserSavingsSummary(user.id);
    return NextResponse.json({ summary });
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/savings error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar caixinhas" },
      { status: 500 }
    );
  }
}
