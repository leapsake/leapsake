// The planner: the notifications that should be pending, deterministic in
// `now`. The horizon is the caller's; see the README.
import { type NotificationCopy, partOfDayOf, variantOf } from "./copy.js";
import {
  civilFromDueMs,
  dueDateMs,
  reminderLabel,
  todayCivil,
} from "@leapsake/schema";
import type { CivilDate, ReminderCategory } from "@leapsake/schema";
import { BELATED_DAYS, NOTIFICATION_WINDOW_DAYS } from "@leapsake/reminders";

/** How a device wants its reminders to reach it. `each` is planned exactly
 *  like `digest`; v0.1 builds could still store it. */
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
  /** Epoch-ms UTC midnight of the occasion it counts down to; null for none. */
  occurrenceDate?: number | null;
  completedAt: number | null;
  /** Epoch-ms UTC midnight of the day a snooze ends; `null` if not snoozed. */
  snoozedUntil: number | null;
  deletedAt: number | null;
  category: ReminderCategory;
}

/** The fields of a `notification_settings` row the planner reads. */
export interface NotificationPolicy {
  mode: NotificationMode;
  /** Minutes past local midnight, one digest each. */
  deliveryMinutes: readonly number[];
  /** The reminder categories that notify; the rest stay silent. */
  categories: readonly ReminderCategory[];
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
  copy: NotificationCopy,
  now: number,
  options: PlanOptions = {},
): DesiredNotification[] {
  if (policy.mode === "off") return [];
  const budget = options.budget ?? NOTIFICATION_BUDGET;

  const days = reminders
    .filter((reminder) => policy.categories.includes(reminder.category))
    .flatMap((reminder) =>
      notifyDaysOf(reminder, now).map((day) => ({ reminder, day })),
    );
  // `each` falls through to the digest too; one-per-reminder was `planEach`.
  const planned = planDigest(days, policy, copy);

  const live = planned.filter((n) => n.fireAt > now);
  live.sort((a, b) => a.fireAt - b.fireAt);

  // A slot is taken back for the notice only if the full plan warrants one;
  // `slice` and `- 1` both behave on `Infinity`.
  const full = live.slice(0, budget);
  if (tripwireFor(full, copy, now) === null) return full;

  // Coverage now ends earlier, so the notice is derived again.
  const scheduled = live.slice(0, budget - 1);
  const tripwire = tripwireFor(scheduled, copy, now);
  return tripwire === null ? scheduled : [...scheduled, tripwire];
}

/** How far before coverage lapses the {@link tripwireFor} notice fires. */
const TRIPWIRE_LEAD_DAYS = 30;

const TRIPWIRE_ID = "tripwire";

/** The service notice a month before coverage runs out, or `null` with no
 *  coverage or too little to warn ahead of it. */
function tripwireFor(
  scheduled: readonly DesiredNotification[],
  copy: NotificationCopy,
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
    ...copy.runningOut,
    // The app itself is the destination.
    reminderId: null,
  };
}

const DAY_MS = 86_400_000;

/** The days a reminder notifies on: every day it sits in Today undone; see the
 *  README's _Which days notify_. */
function notifyDaysOf(r: NotifiableReminder, now: number): CivilDate[] {
  if (r.completedAt !== null || r.deletedAt !== null) return [];

  const today = dueDateMs(todayCivil(now));
  const lands = Math.max(today, r.activeFrom ?? today, r.snoozedUntil ?? today);
  const horizon = today + NOTIFICATION_WINDOW_DAYS * DAY_MS;
  // A row with an occasion is pruned once its belated tail ends.
  const leaves =
    r.occurrenceDate === null || r.occurrenceDate === undefined
      ? horizon
      : Math.min(horizon, r.occurrenceDate + BELATED_DAYS * DAY_MS);

  const days: CivilDate[] = [];
  for (let day = lands; day <= leaves; day += DAY_MS)
    days.push(civilFromDueMs(day));
  return days;
}

/** One reminder on one of its days: what the digest plans from. */
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
  copy: NotificationCopy,
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
    .flatMap(([key, { day, reminders: dayReminders }]) => {
      const labels = dayReminders.map((r) => reminderLabel(r));
      const first = Math.min(...policy.deliveryMinutes);
      return policy.deliveryMinutes.map((minute) => {
        const id = `digest:${key}@${clockOf(minute)}`;
        return {
          id,
          fireAt: fireAtFor(day, minute),
          ...copy.digest({
            followUp: minute !== first,
            partOfDay: partOfDayOf(minute),
            labels,
            variant: variantOf(id),
          }),
          // A digest of one reminder opens it; of more, the list.
          reminderId: dayReminders.length === 1 ? dayReminders[0].id : null,
        };
      });
    });
}

/** Minute 540 as `0900`, keying a day's digests apart. */
function clockOf(minute: number): string {
  return `${pad2(Math.floor(minute / 60))}${pad2(minute % 60)}`;
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
