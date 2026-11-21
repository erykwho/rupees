import { requireUser } from "@/lib/auth";
import { listAuditEvents } from "@/lib/audit-service";
import { EventsTimeline } from "@/components/events-timeline";

export const dynamic = "force-dynamic";

export default async function EventosPage() {
  const user = await requireUser();
  const initialData = await listAuditEvents(user.id, { limit: 30 });

  return (
    <EventsTimeline
      initialEvents={initialData.events}
      initialNextCursor={initialData.nextCursor}
      initialTotalCount={initialData.totalCount}
    />
  );
}
