/**
 * Scheduling math for reminders: civil ("wall-clock") dates, the epoch-ms a due
 * date is stored under, the "in N days" countdown, and the soonest-first order.
 *
 * **"Today" is the user's local civil date** — a calendar reminder fires on the
 * day the user calls it, not a UTC instant. This is a deliberate, documented
 * departure from the codebase's otherwise UTC-only convention: everywhere else a
 * timestamp is an epoch-ms instant, but a *due date* is a whole day. We reconcile
 * the two by storing the due date as **UTC midnight of that civil day** (so it is
 * still a plain epoch-ms integer that sorts and merges like any other column) and
 * doing all day arithmetic on the calendar parts, never on elapsed milliseconds
 * (so DST and time-of-day never shift the count). A pure module, unit-tested like
 * `birthday-query.ts`; the later automated-reminder engine builds on it.
 */

/** A calendar date with no time-of-day: `month` is 1–12, `day` is 1–31. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/**
 * The viewer's **local** civil date — the day their wall clock shows. Pass `now`
 * (epoch ms) to derive it from a fixed instant; defaults to the real clock.
 */
export function todayCivil(now: number = Date.now()): CivilDate {
  const d = new Date(now);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/**
 * Whole days from civil date `a` to civil date `b` (i.e. `b − a`): positive when
 * `b` is later. Both are anchored to UTC midnight so only the calendar parts
 * count — the result is DST- and timezone-immune.
 */
export function daysUntil(a: CivilDate, b: CivilDate): number {
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** The epoch-ms a civil due date is stored as: UTC midnight of that day. */
export function dueDateMs(civil: CivilDate): number {
  return Date.UTC(civil.year, civil.month - 1, civil.day);
}

/** Inverse of {@link dueDateMs}: the civil date a stored due-date epoch encodes. */
export function civilFromDueMs(dueMs: number): CivilDate {
  const d = new Date(dueMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Parse an `<input type="date">` / ISO `YYYY-MM-DD` string into the epoch-ms a due
 * date is stored under, or `null` for a blank/malformed value. The single place
 * a client turns a date field into a stored due date (both desktop and mobile).
 */
export function dueMsFromIso(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return dueDateMs({ year, month, day });
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Format a stored due-date epoch back to `YYYY-MM-DD` for a date input's value. */
export function isoFromDueMs(dueMs: number): string {
  const { year, month, day } = civilFromDueMs(dueMs);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A human countdown from `now` to a stored due date: "today", "tomorrow",
 * "yesterday", "in N days" (up to a fortnight), "in N weeks" beyond that, and
 * "N days ago" for a past due date. `now` defaults to the real clock; both ends
 * are read as civil days, so the phrasing flips exactly at local midnight.
 */
export function formatDueIn(dueMs: number, now: number = Date.now()): string {
  const days = daysUntil(todayCivil(now), civilFromDueMs(dueMs));
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days < -1) return `${-days} days ago`;
  if (days < 14) return `in ${days} days`;
  return `in ${Math.round(days / 7)} weeks`;
}

/**
 * Order open reminders **soonest-first**: by `dueDate` ascending with undated
 * reminders (null) sinking to the bottom, then newest-created first as the
 * tiebreak (matching the repo's default `created_at DESC`).
 */
export function compareReminderDue(
  a: { dueDate: number | null; createdAt: number },
  b: { dueDate: number | null; createdAt: number },
): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1; // nulls last
    if (b.dueDate === null) return -1;
    return a.dueDate - b.dueDate; // soonest first
  }
  return b.createdAt - a.createdAt; // newest first
}
