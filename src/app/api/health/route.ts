import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const checkDb =
    searchParams.get("db") === "1" || searchParams.get("db") === "true";
  const timestamp = new Date().toISOString();

  if (!checkDb) {
    return NextResponse.json(
      { status: "ok", timestamp },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json(
      { status: "ok", db: "unconfigured", timestamp },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: "ok", db: "ok", timestamp },
      { status: 200, headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error("[api/health] DB check failed:", err);
    return NextResponse.json(
      { status: "degraded", db: "error", timestamp },
      { status: 503, headers: NO_STORE_HEADERS }
    );
  }
}
