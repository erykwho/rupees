import { NextResponse } from "next/server";
import { authErrorResponse, requireUser } from "@/lib/auth";
import { RevertConflictError, revertAuditEvent } from "@/lib/audit-service";
import {
  invalidateUserFinancialCaches,
  invalidateUserSavingsCaches,
} from "@/lib/server-cache";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const revertEvent = await revertAuditEvent(user.id, id);
    if (
      revertEvent.entityType === "SAVINGS_GOAL" ||
      revertEvent.entityType === "SAVINGS_MOVEMENT"
    ) {
      invalidateUserSavingsCaches(user.id);
    } else {
      invalidateUserFinancialCaches(user.id);
    }

    return NextResponse.json(
      {
        reverted: true,
        revertEventId: revertEvent.id,
      },
      { status: 200 }
    );
  } catch (err) {
    const authRes = authErrorResponse(err);
    if (authRes) return authRes;
    if (err instanceof RevertConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("POST /api/events/[id]/revert error:", err);
    return NextResponse.json(
      { error: "Erro ao reverter evento" },
      { status: 500 }
    );
  }
}
