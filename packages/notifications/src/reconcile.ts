/**
 * The reconcile half of `08 Inc 2`: diff {@link planNotifications}'s desired
 * set against what the OS actually has pending, and drive a {@link
 * NotificationScheduler} port through the delta. Same shape as
 * `@leapsake/reminders`' `regenerateSystemReminders` reconcile, one layer
 * out — insert-when-absent, prune-when-undesired — adapted for a scheduler
 * that can't update a pending notification in place, only cancel and
 * re-schedule it.
 */
import type { DesiredNotification } from "./planner.js";

/** A notification the OS reports as still pending — the same shape a desired
 *  entry carries, so content drift (not just presence) can be detected. */
export type PendingNotification = Pick<
  DesiredNotification,
  "id" | "fireAt" | "title" | "body"
>;

/**
 * The OS notification surface {@link reconcile} drives — the port Inc 3's
 * `expo-notifications` adapter implements, and what lets a future desktop
 * applier (Electron's `Notification`) reuse this same reconcile unchanged.
 */
export interface NotificationScheduler {
  schedule(notification: DesiredNotification): Promise<void>;
  cancel(id: string): Promise<void>;
}

/**
 * Reconcile `pending` to `desired`: schedule anything missing or whose
 * content (`fireAt`/`title`/`body`) has drifted since it was scheduled —
 * cancelling the stale entry first, since an OS local notification has no
 * "update in place" — and cancel anything pending that is no longer desired.
 * An entry that already matches byte-for-byte is left alone, so a
 * steady-state reconcile issues no scheduler calls at all. `cancelled` in the
 * return counts every `cancel` call — both a drift-triggered replace and a
 * prune — so it reads as "how many `cancel` calls happened", not just prunes.
 */
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
