import { after } from "next/server";

/**
 * Schedules non-blocking background work to run after the HTTP response is sent.
 * Safely degrades to a no-op outside a Next.js request context (e.g. unit tests or CLI scripts).
 */
export function scheduleBackgroundWork(task: () => Promise<void>): boolean {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        console.error("Background task error:", err);
      }
    });
    return true;
  } catch {
    return false;
  }
}
