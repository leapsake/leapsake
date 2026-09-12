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

import { type MilestoneKind, kindDefs } from "./milestone.js";

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

/** Whole civil days from today to a stored date — the arithmetic every
 *  countdown below shares with {@link formatDueIn}. */
function daysAhead(ms: number, now: number): number {
  return daysUntil(todayCivil(now), civilFromDueMs(ms));
}

/**
 * A row's deadline as Today shows it *(owner, 2026-09-11)*: "Due today", "Due
 * tomorrow", "Due in N days" up to a fortnight, "Due in N weeks" beyond. *Due*
 * is the word that keeps a question's countdown from reading as its occasion —
 * a deadline, not the birthday.
 */
export function formatDueCountdown(
  dueMs: number,
  now: number = Date.now(),
): string {
  const days = daysAhead(dueMs, now);
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 14) return `Due in ${days} days`;
  return `Due in ${Math.round(days / 7)} weeks`;
}

/** When a row that was put off comes back to Today: "Back tomorrow", "Back in N
 *  days", "Back in N weeks". */
export function formatBackIn(ms: number, now: number = Date.now()): string {
  const days = daysAhead(ms, now);
  if (days <= 1) return "Back tomorrow";
  if (days < 14) return `Back in ${days} days`;
  return `Back in ${Math.round(days / 7)} weeks`;
}

/** When a row not on display yet arrives on Today: "Tomorrow", "In N days",
 *  "In N weeks". */
export function formatComingIn(ms: number, now: number = Date.now()): string {
  const days = daysAhead(ms, now);
  if (days <= 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
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

/** The proleptic-Gregorian leap-year test, so Feb-29 can be clamped correctly. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * A `(month, day)` placed in `year`, with **Feb-29 falling back to Feb-28** in a
 * non-leap year — the pragmatic convention (mark it on the 28th rather than skip
 * three years in four).
 *
 * Shared by {@link nextOccurrence} and {@link recentOccurrence} so the two can
 * never disagree about which day a leap-day milestone lands on. They must agree:
 * a reminder minted against the forward-looking date has to still be recognised
 * by the backward-looking one the morning after, or it would be tombstoned and
 * re-minted under a new identity.
 */
function placeInYear(month: number, day: number, year: number): CivilDate {
  return month === 2 && day === 29 && !isLeapYear(year)
    ? { year, month: 2, day: 28 }
    : { year, month, day };
}

/**
 * A milestone's partial date, as {@link nextOccurrence} reads it: the same
 * individually-nullable parts a `Milestone` carries. A concrete calendar day
 * needs **both** a month and a day; the year is used only to place a *one-time*
 * event and is ignored for a recurring one (whose anchor year, if any, is just
 * the first occurrence).
 */
export interface OccurrenceParts {
  year: number | null;
  month: number | null;
  day: number | null;
}

/**
 * The next calendar day a milestone "happens", relative to `today`, or `null`
 * when it has no upcoming concrete day. This is the date-anchoring the automated
 * reminder engine schedules against, kept here beside the rest of the civil-date
 * math and unit-tested in isolation.
 *
 * The rule depends on whether the kind **recurs annually** (`kindDefs`):
 *
 * - **Recurring** (birthdays, anniversaries): the next occurrence of `(month,
 *   day)` on or after today — this year's if it hasn't passed, otherwise next
 *   year's. The year on the parts is irrelevant. A **Feb-29** date falls back to
 *   **Feb-28** in a non-leap target year (the pragmatic convention — mark it on
 *   the 28th rather than skip three years in four).
 * - **One-time** (graduation, a job start): the event's own date, but only if it
 *   is today or still in the future; a past one-time event returns `null` (it
 *   won't happen again). A one-time event needs a *full* date — with no year
 *   there is nothing to place, so it returns `null`.
 *
 * Either way, a date with no month **or** no day (`none` / `year` / `year-month`
 * precision) has no concrete day and returns `null`.
 */
export function nextOccurrence(
  kind: MilestoneKind,
  parts: OccurrenceParts,
  today: CivilDate,
): CivilDate | null {
  const { month, day } = parts;
  if (month === null || day === null) return null; // no concrete calendar day

  if (kindDefs[kind].recursAnnually) {
    const thisYear = placeInYear(month, day, today.year);
    if (daysUntil(today, thisYear) >= 0) return thisYear;
    return placeInYear(month, day, today.year + 1);
  }

  // One-time: needs a concrete year to place, and only counts if not yet past.
  if (parts.year === null) return null;
  const occ = placeInYear(month, day, parts.year);
  return daysUntil(today, occ) >= 0 ? occ : null;
}

/**
 * The most recent day a milestone happened, **strictly before** `today` and no
 * more than `withinDays` ago — or `null` when there is no such day.
 *
 * The mirror of {@link nextOccurrence}, and the reason it has to exist: a
 * recurring occurrence flips to *next year's* date the morning after it passes,
 * so nothing looking forward can ever report "yesterday". Without this, a
 * birthday you missed simply vanishes overnight and you never learn you missed
 * it. The reminder engine walks both, giving a missed reminder a short belated
 * tail (`BELATED_DAYS` there) before it retires.
 *
 * **Strictly before** is what keeps the two functions disjoint: on the day
 * itself {@link nextOccurrence} already answers, so this returns `null` and no
 * occurrence is ever considered twice.
 *
 * The year boundary is the case that matters. A Dec-31 birthday read on Jan-1
 * must answer with **last** year's date, because a system reminder's identity is
 * keyed on the occurrence year — answering with this year's would mint a second,
 * unrelated reminder instead of keeping the one the user already has.
 */
export function recentOccurrence(
  kind: MilestoneKind,
  parts: OccurrenceParts,
  today: CivilDate,
  withinDays: number,
): CivilDate | null {
  const { month, day } = parts;
  if (month === null || day === null) return null; // no concrete calendar day

  let occ: CivilDate;
  if (kindDefs[kind].recursAnnually) {
    const thisYear = placeInYear(month, day, today.year);
    // Still ahead of us (or today) ⇒ the one that has *been* is last year's.
    occ =
      daysUntil(today, thisYear) >= 0
        ? placeInYear(month, day, today.year - 1)
        : thisYear;
  } else {
    if (parts.year === null) return null; // nothing to place
    occ = placeInYear(month, day, parts.year);
  }

  const days = daysUntil(today, occ);
  return days < 0 && days >= -withinDays ? occ : null;
}
