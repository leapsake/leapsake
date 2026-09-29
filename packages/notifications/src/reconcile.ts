// Diffs the desired notifications against the OS's pending ones and drives
// the scheduler through the delta; see the README.
import type { DesiredNotification } from "./planner.js";

/** A pending notification, shaped like a desired one so drift shows. */
export type PendingNotification = Pick<
  DesiredNotification,
  "id" | "fireAt" | "title" | "body"
>;

/** The OS notification port {@link reconcile} drives. */
export interface NotificationScheduler {
  schedule(notification: DesiredNotification): Promise<void>;
  cancel(id: string): Promise<void>;
}

/** Schedules what is missing or drifted, cancels what is undesired; a match
 *  is left alone. `cancelled` counts every cancel call. */
export async function reconcile(
  desired: readonly DesiredNotification[],
  pending: readonly PendingNotification[],
  scheduler: NotificationScheduler,
): Promise<{ scheduled: number; cancelled: number }> {
  const pendingById = new Map(pending.map((p) => [p.id, p]));
  const desiredIds = new Set(desired.map((d) => d.id));

  let scheduled = 0;
  let cancelled = 0;
  for (const d of desired) {
    const existing = pendingById.get(d.id);
    if (existing !== undefined && isUnchanged(existing, d)) continue;
    if (existing !== undefined) {
      await scheduler.cancel(d.id);
      cancelled++;
    }
    await scheduler.schedule(d);
    scheduled++;
  }

  for (const p of pending) {
    if (!desiredIds.has(p.id)) {
      await scheduler.cancel(p.id);
      cancelled++;
    }
  }

  return { scheduled, cancelled };
}

function isUnchanged(a: PendingNotification, b: DesiredNotification): boolean {
  return a.fireAt === b.fireAt && a.title === b.title && a.body === b.body;
}
