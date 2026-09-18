// "Today" is the user's local civil date. A due date is stored as UTC midnight
// of that day, and day arithmetic uses calendar parts, never elapsed ms.

import { type MilestoneKind, kindDefs } from "./milestone.js";

/** A calendar date with no time-of-day: `month` is 1–12, `day` is 1–31. */
export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** The viewer's local civil date at `now`. */
export function todayCivil(now: number = Date.now()): CivilDate {
  const d = new Date(now);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Whole days from `a` to `b`, positive when `b` is later; immune to DST. */
export function daysUntil(a: CivilDate, b: CivilDate): number {
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** The epoch-ms a civil due date is stored as: UTC midnight of that day. */
export function dueDateMs(civil: CivilDate): number {
  return Date.UTC(civil.year, civil.month - 1, civil.day);
}

/** Inverse of {@link dueDateMs}: the civil date a stored due date encodes. */
export function civilFromDueMs(dueMs: number): CivilDate {
  const d = new Date(dueMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** A `YYYY-MM-DD` date field as a stored due date, or `null` if malformed. */
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

/** A stored due date as `YYYY-MM-DD`, for a date input's value. */
export function isoFromDueMs(dueMs: number): string {
  const { year, month, day } = civilFromDueMs(dueMs);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A countdown to a stored due date: "today", "in N days" up to a fortnight,
 * "in N weeks" beyond, "N days ago" when past. Flips at local midnight.
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

/** Whole civil days from today to a stored date. */
function daysAhead(ms: number, now: number): number {
  return daysUntil(todayCivil(now), civilFromDueMs(ms));
}

/**
 * A row's deadline as Today shows it: "Due today", "Due in N days" up to a
 * fortnight, "Due in N weeks" beyond.
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

/** When a put-off row returns to Today: "Back tomorrow", "Back in N days". */
export function formatBackIn(ms: number, now: number = Date.now()): string {
  const days = daysAhead(ms, now);
  if (days <= 1) return "Back tomorrow";
  if (days < 14) return `Back in ${days} days`;
  return `Back in ${Math.round(days / 7)} weeks`;
}

/** When a row not yet shown arrives on Today: "Tomorrow", "In N days". */
export function formatComingIn(ms: number, now: number = Date.now()): string {
  const days = daysAhead(ms, now);
  if (days <= 1) return "Tomorrow";
  if (days < 14) return `In ${days} days`;
  return `In ${Math.round(days / 7)} weeks`;
}

/** Soonest due first, undated last, then newest created first. */
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

/** The proleptic-Gregorian leap-year test. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * `(month, day)` in `year`, Feb-29 falling back to Feb-28. Both occurrence
 * walks use it, so a leap-day reminder keeps one identity either side of it.
 */
function placeInYear(month: number, day: number, year: number): CivilDate {
  return month === 2 && day === 29 && !isLeapYear(year)
    ? { year, month: 2, day: 28 }
    : { year, month, day };
}

/**
 * A milestone's partial date. A concrete day needs month and day; the year only
 * places a one-time event.
 */
export interface OccurrenceParts {
  year: number | null;
  month: number | null;
  day: number | null;
}

/**
 * The next day on or after `today` a milestone happens, or `null`. A one-time
 * kind needs a full date that has not passed.
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
 * The latest day strictly before `today`, and within `withinDays`, that a
 * milestone happened, or `null`. Disjoint from {@link nextOccurrence}.
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
