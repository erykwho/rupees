import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { searchTickersForClass } from "@/lib/ticker-validator";
import type { AssetClassKey } from "@/lib/domain/types";

const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(40),
  assetClass: z.enum([
    "FIXED_INCOME",
    "BR_STOCK",
    "BR_FII",
    "US_STOCK",
    "US_REIT",
    "EMERGENCY_RESERVE",
  ]),
});

export async function GET(request: Request) {
  try {
    await requireUser();
    const { searchParams } = new URL(request.url);
    const parsed = searchQuerySchema.safeParse({
      q: searchParams.get("q") ?? "",
      assetClass: searchParams.get("assetClass") ?? "",
    });

    if (!parsed.success) {
      return NextResponse.json({ results: [], unavailable: false });
    }

    const response = await searchTickersForClass(
      parsed.data.q,
      parsed.data.assetClass as AssetClassKey
    );

    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    console.error("GET /api/tickers/search error:", err);
    return NextResponse.json({ results: [], unavailable: true });
  }
}
