/**
 * The pure core of `08 Inc 2` (`plans/v0-1_08_local-notifications.md`): compute
 * the set of OS notifications that *should* be pending, given the reminder rows
 * and a device's policy. No `@leapsake/core` or `@leapsake/data` dependency, no
 * OS calls — {@link planNotifications} is deterministic in `now` and
 * independently unit-testable.
 *
 * The ~30-day horizon the plan describes is **not enforced here**. It falls out
 * of reading reminder rows as-is: a `system` reminder simply doesn't exist in
 * the store until its due date is within `@leapsake/reminders`' `LEAD_DAYS` of
 * today, so the candidate set this planner sees is already bounded for the
 * common case. A far-future `user` reminder just adds one more candidate; see
 * `each` mode's budget below for the backstop.
 */
import { civilFromDueMs, reminderLabel } from "@leapsake/schema";
import type { CivilDate } from "@leapsake/schema";
import { onboardingRouteOf } from "@leapsake/reminders";

/** How a device wants its reminders to reach it — mirrors
 *  `notificationModeSchema` (`@leapsake/schema`) without importing the full
 *  synced row shape, so a caller can pass either. */
export type NotificationMode = "off" | "digest" | "each";

/** The narrow slice of a `Reminder` row {@link planNotifications} reads —
 *  everything the "a reminder notifies iff…" rule needs, and nothing a repo
 *  read wouldn't already have to hand. */
export interface NotifiableReminder {
  id: string;
  title: string | null;
  body: string | null;
  /** Epoch-ms UTC midnight of the civil due day; `null` = no due date. */
  dueDate: number | null;
  completedAt: number | null;
  snoozedUntil: number | null;
  deletedAt: number | null;
}

/** The fields of a device's `notification_settings` row {@link planNotifications}
 *  actually reads — a caller may pass the full synced row unchanged. */
export interface NotificationPolicy {
  mode: NotificationMode;
  /** Minutes past local midnight the notification fires at. */
  deliveryMinute: number;
}

/**
 * One OS notification the device should have pending. `id` is stable across
 * reconciles for the same (mode, day-or-reminder) — see {@link reconcile} —
 * so it never collides across `digest`/`each` entries for the same reminder.
 */
export interface DesiredNotification {
  id: string;
  /** Local wall-clock fire instant, epoch ms — see {@link fireAtFor}. */
  fireAt: number;
  title: string;
  body: string;
  /** The reminder this notification's tap-through targets, or `null` for a
   *  digest bundling more than one reminder (opens the reminder list instead). */
  reminderId: string | null;
}

/**
 * iOS caps pending local notifications at 64 and silently drops the rest.
 * Budgeted to 60, not 64, so a stray notification scheduled elsewhere in the
 * app can't push a real one off the end. `digest` mode never approaches this
 * (at most one entry per day over the horizon); `each` mode is the one that
 * can, in a pathological month, and is the mode this budget actually binds.
 */
export const NOTIFICATION_BUDGET = 60;

/**
 * Compute the desired set of pending OS notifications for `policy` as of
 * `now` — the planning half of "compute the desired set, diff it against
 * what is scheduled, cancel and schedule the delta" (see {@link reconcile}
 * for the other half).
 *
 * `off` yields nothing. `digest` bundles every notifying reminder due on the
 * same civil day into one notification at `policy.deliveryMinute`, its copy
 * computed now (see {@link digestCopy}) — going stale only if the underlying
 * data changes before the next reconcile. `each` explodes the same content
 * into one notification per reminder, at the *same* `deliveryMinute` — it is
 * not more timely, only a tap target per item — capped to the soonest
 * {@link NOTIFICATION_BUDGET}.
 *
 * Entries whose fire time has already passed `now` are dropped: there is
 * nothing useful to schedule for a moment already gone, and the next
 * reconcile (boot / foreground / post-write, the same triggers
 * `regenerateSystemReminders` runs on) picks up whatever is still ahead.
 */
export function planNotifications(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
  now: number,
): DesiredNotification[] {
  if (policy.mode === "off") return [];

  const eligible = reminders.filter((r) => isNotifiable(r, now));
  const planned =
    policy.mode === "digest"
      ? planDigest(eligible, policy)
      : planEach(eligible, policy);

  return planned.filter((n) => n.fireAt > now);
}

/**
 * "A reminder notifies iff it has a non-null `dueDate`, is not completed, is
 * not currently snoozed, is not soft-deleted, and `onboardingRouteOf(id) ===
 * null`" (the plan's exact rule) — the single place that predicate is
 * evaluated, so the planner and any future caller can't drift from it.
 * "Currently snoozed" mirrors `@leapsake/view-models`' `isSnoozed`:
 * `snoozedUntil !== null && snoozedUntil > now`.
 */
function isNotifiable(r: NotifiableReminder, now: number): boolean {
  return (
    r.dueDate !== null &&
    r.completedAt === null &&
    r.deletedAt === null &&
    !(r.snoozedUntil !== null && r.snoozedUntil > now) &&
    onboardingRouteOf(r.id) === null
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for a civil date — the digest's per-day grouping key and id
 *  suffix, mirroring `@leapsake/reminders`' private `isoOf`. */
function isoOf(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function planDigest(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  const byDay = new Map<
    string,
    { day: CivilDate; reminders: NotifiableReminder[] }
  >();
  for (const r of reminders) {
    // Non-null by construction — isNotifiable required it.
    const day = civilFromDueMs(r.dueDate as number);
    const key = isoOf(day);
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, { day, reminders: [r] });
    else bucket.reminders.push(r);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, { day, reminders: dayReminders }]) => {
      const { title, body } = digestCopy(dayReminders);
      return {
        id: `digest:${key}`,
        fireAt: fireAtFor(day, policy.deliveryMinute),
        title,
        body,
        // A digest of exactly one reminder can tap straight through to it;
        // more than one opens the reminder list instead (no single target).
        reminderId: dayReminders.length === 1 ? dayReminders[0].id : null,
      };
    });
}

function planEach(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  const all = reminders.map((r) => ({
    id: `each:${r.id}`,
    fireAt: fireAtFor(
      civilFromDueMs(r.dueDate as number),
      policy.deliveryMinute,
    ),
    title: "Leapsake",
    body: reminderLabel(r),
    reminderId: r.id,
  }));
  all.sort((a, b) => a.fireAt - b.fireAt);
  return all.slice(0, NOTIFICATION_BUDGET);
}

/**
 * A day-with-content's notification copy. **Provisional wording** — Inc 3
 * (the mobile adapter) is free to change it without touching the reconcile
 * mechanics above; only the shape (`title`/`body`) is load-bearing.
 */
function digestCopy(reminders: readonly NotifiableReminder[]): {
  title: string;
  body: string;
} {
  const labels = reminders.map((r) => reminderLabel(r));
  if (labels.length === 1) return { title: "Leapsake", body: labels[0] };
  const [lead, ...rest] = labels;
  const body =
    rest.length === 1
      ? `${lead} and ${rest[0]}`
      : `${lead} and ${rest.length} more`;
  return { title: `${labels.length} reminders today`, body };
}

/**
 * The absolute fire instant for a civil day + minutes-past-midnight, in the
 * **current** time zone at schedule time — deliberately the local `Date`
 * constructor, not the UTC-anchored `dueDateMs`/`civilFromDueMs` a due date is
 * *stored* under. A due date is a timezone-free calendar day; a notification
 * is a real instant the OS fires at, and those are different math. Travel or
 * a DST shift is corrected by the next reconcile re-deriving this from
 * scratch, never by adjusting a stored instant.
 */
function fireAtFor(day: CivilDate, deliveryMinute: number): number {
  return new Date(
    day.year,
    day.month - 1,
    day.day,
    Math.floor(deliveryMinute / 60),
    deliveryMinute % 60,
    0,
    0,
  ).getTime();
}
