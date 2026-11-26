import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { listAuditEvents } from "@/lib/audit-service";
import type {
  AuditActionKey,
  AuditEntityTypeKey,
  AuditPillarFilter,
} from "@/lib/domain/audit";

const VALID_PILLARS = new Set<AuditPillarFilter>([
  "ALL",
  "LONG_TERM",
  "SAVINGS",
]);

const VALID_ENTITY_TYPES = new Set<AuditEntityTypeKey | "ALL">([
  "ALL",
  "ASSET",
  "TRANSACTION",
  "GOAL",
  "SECTOR_GOAL",
  "SAVINGS_GOAL",
  "SAVINGS_MOVEMENT",
]);

const VALID_ACTIONS = new Set<AuditActionKey | "ALL">([
  "ALL",
  "CREATE",
  "UPDATE",
  "DELETE",
  "REVERT",
]);

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);

    const rawPillar = (searchParams.get("pillar") ?? "ALL") as AuditPillarFilter;
    const rawEntityType = (searchParams.get("entityType") ?? "ALL") as
      | AuditEntityTypeKey
      | "ALL";
    const rawAction = (searchParams.get("action") ?? "ALL") as
      | AuditActionKey
      | "ALL";
    const q = searchParams.get("q") ?? undefined;
    const cursor = searchParams.get("cursor") ?? undefined;
    const rawLimit = Number(searchParams.get("limit") ?? "30");

    const pillar = VALID_PILLARS.has(rawPillar) ? rawPillar : "ALL";
    const entityType = VALID_ENTITY_TYPES.has(rawEntityType)
      ? rawEntityType
      : "ALL";
    const action = VALID_ACTIONS.has(rawAction) ? rawAction : "ALL";
    const limit = Number.isFinite(rawLimit) ? rawLimit : 30;

    const result = await listAuditEvents(user.id, {
      pillar,
      entityType,
      action,
      q,
      cursor,
      limit,
    });

    return NextResponse.json(result);
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    console.error("GET /api/events error:", err);
    return NextResponse.json(
      { error: "Erro ao carregar eventos" },
      { status: 500 }
    );
  }
}
