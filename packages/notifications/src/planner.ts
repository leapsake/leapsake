// The planner: the notifications that should be pending, deterministic in
// `now`. The horizon is the caller's; see the README.
import { civilFromDueMs, daysUntil, reminderLabel } from "@leapsake/schema";
import type { CivilDate } from "@leapsake/schema";
import { onboardingRouteOf } from "@leapsake/reminders";

/** How a device wants its reminders to reach it. */
export type NotificationMode = "off" | "digest" | "each";

/** The slice of a `Reminder` row {@link planNotifications} reads. */
export interface NotifiableReminder {
  id: string;
  title: string | null;
  body: string | null;
  /** Epoch-ms UTC midnight of the civil due day; `null` = no due date. */
  dueDate: number | null;
  /** Epoch-ms UTC midnight of the day this goes on display; null if it is. */
  activeFrom?: number | null;
  completedAt: number | null;
  /** Epoch-ms UTC midnight of the day a snooze ends; `null` if not snoozed. */
  snoozedUntil: number | null;
  deletedAt: number | null;
}

/** The fields of a `notification_settings` row the planner reads. */
export interface NotificationPolicy {
  mode: NotificationMode;
  /** Minutes past local midnight the notification fires at. */
  deliveryMinute: number;
}

/** One notification that should be pending; its `id` is stable per mode and
 *  day or reminder. */
export interface DesiredNotification {
  id: string;
  /** Local wall-clock fire instant, epoch ms. */
  fireAt: number;
  title: string;
  body: string;
  /** The reminder a tap opens, or `null` to open the list. */
  reminderId: string | null;
}

/** The default cap: the tightest platform ceiling, so no platform overshoots.
 *  Each platform's own number lives with its scheduler. */
export const NOTIFICATION_BUDGET = 60;

/** Per-call overrides for {@link planNotifications}. */
export interface PlanOptions {
  /** The most notifications the caller's platform can hold pending;
   *  `Infinity` suits no platform this app ships on. */
  budget?: number;
}

/**
 * The notifications that should be pending: past ones dropped, then capped to
 * the soonest `budget`, keeping a slot for {@link tripwireFor} when warranted.
 */
export function planNotifications(
  reminders: readonly NotifiableReminder[],
  policy: NotificationPolicy,
  now: number,
  options: PlanOptions = {},
): DesiredNotification[] {
  if (policy.mode === "off") return [];
  const budget = options.budget ?? NOTIFICATION_BUDGET;

  const days = reminders.flatMap((reminder) =>
    notifyDaysOf(reminder).map((day) => ({ reminder, day })),
  );
  const planned =
    policy.mode === "digest"
      ? planDigest(days, policy)
      : planEach(days, policy);

  const live = planned.filter((n) => n.fireAt > now);
  live.sort((a, b) => a.fireAt - b.fireAt);

  // A slot is taken back for the notice only if the full plan warrants one;
  // `slice` and `- 1` both behave on `Infinity`.
  const full = live.slice(0, budget);
  if (tripwireFor(full, now) === null) return full;

  // Coverage now ends earlier, so the notice is derived again.
  const scheduled = live.slice(0, budget - 1);
  const tripwire = tripwireFor(scheduled, now);
  return tripwire === null ? scheduled : [...scheduled, tripwire];
}

/** How far before coverage lapses the {@link tripwireFor} notice fires. */
const TRIPWIRE_LEAD_DAYS = 30;

const TRIPWIRE_ID = "tripwire";

/** The service notice a month before coverage runs out, or `null` with no
 *  coverage or too little to warn ahead of it. */
function tripwireFor(
  scheduled: readonly DesiredNotification[],
  now: number,
): DesiredNotification | null {
  if (scheduled.length === 0) return null;

  const coverageEnd = scheduled[scheduled.length - 1].fireAt;
  const fireAt = coverageEnd - TRIPWIRE_LEAD_DAYS * 86_400_000;
  if (fireAt <= now) return null;

  return {
    // A fixed id and a coverage-based `fireAt`, so a re-plan changes nothing.
    id: TRIPWIRE_ID,
    fireAt,
    // Provisional wording; never claim notifications were switched off, nor
    // point at a setting: opening the app is the fix.
    title: "Your reminders are running out",
    body: "Open Leapsake to keep them coming.",
    // The app itself is the destination.
    reminderId: null,
  };
}

/** The days a reminder notifies on: its due day and each day it enters Today;
 *  see the README's _Which days notify_. */
function notifyDaysOf(r: NotifiableReminder): CivilDate[] {
  if (
    r.completedAt !== null ||
    r.deletedAt !== null ||
    onboardingRouteOf(r.id) !== null
  )
    return [];

  const snoozeEnd =
    r.snoozedUntil === null ? null : civilFromDueMs(r.snoozedUntil);
  const shown =
    r.activeFrom === null || r.activeFrom === undefined
      ? null
      : civilFromDueMs(r.activeFrom);
  const entersToday =
    snoozeEnd !== null && (shown === null || daysUntil(shown, snoozeEnd) > 0)
      ? snoozeEnd
      : shown;
  const due = r.dueDate === null ? null : civilFromDueMs(r.dueDate);

  const days = new Map<string, CivilDate>();
  for (const day of [entersToday, due]) {
    if (day === null) continue;
    if (snoozeEnd !== null && daysUntil(snoozeEnd, day) < 0) continue;
    days.set(isoOf(day), day);
  }
  return [...days.values()];
}

/** One reminder on one of its days: what both modes plan from. */
interface NotifyingDay {
  reminder: NotifiableReminder;
  day: CivilDate;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A civil date as `YYYY-MM-DD`, keying the digest's days and ids. */
function isoOf(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function planDigest(
  days: readonly NotifyingDay[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  const byDay = new Map<
    string,
    { day: CivilDate; reminders: NotifiableReminder[] }
  >();
  // `notifyDaysOf` already yields each reminder once per day.
  for (const { reminder, day } of days) {
    const key = isoOf(day);
    const bucket = byDay.get(key);
    if (bucket === undefined) byDay.set(key, { day, reminders: [reminder] });
    else bucket.reminders.push(reminder);
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
        // A digest of one reminder opens it; of more, the list.
        reminderId: dayReminders.length === 1 ? dayReminders[0].id : null,
      };
    });
}

/** One notification per reminder-day; {@link planNotifications} orders and
 *  caps. */
function planEach(
  days: readonly NotifyingDay[],
  policy: NotificationPolicy,
): DesiredNotification[] {
  return days.map(({ reminder, day }) => ({
    // The day is in the id, as one reminder can notify on two days.
    id: `each:${reminder.id}:${isoOf(day)}`,
    fireAt: fireAtFor(day, policy.deliveryMinute),
    title: "Leapsake",
    body: reminderLabel(reminder),
    reminderId: reminder.id,
  }));
}

/** A day's digest copy: provisional; only its shape matters. */
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

/** The fire instant for a civil day and minute in the current zone: local
 *  wall-clock math, unlike a stored due date. */
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
