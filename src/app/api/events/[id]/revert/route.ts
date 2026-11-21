import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { RevertConflictError, revertAuditEvent } from "@/lib/audit-service";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const revertEvent = await revertAuditEvent(user.id, id);

    return NextResponse.json(
      {
        reverted: true,
        revertEventId: revertEvent.id,
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
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
