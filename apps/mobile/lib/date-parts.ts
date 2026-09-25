import {
  type CivilDate,
  civilFromDueMs,
  daysUntil,
  dueDateMs,
  todayCivil,
} from "@leapsake/schema";

/** A date as typed into `DatePartsFields`: each part a string, nothing parsed. */
export interface DateParts {
  month: string;
  day: string;
  year: string;
}

/** A typed part as a whole number, or null when blank or not all digits. */
export function wholeNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

/** Whether a typed month is blank or one of 1–12. */
export function monthBlankOrValid(raw: string): boolean {
  if (raw.trim() === "") return true;
  const month = wholeNumberOrNull(raw);
  return month !== null && month >= 1 && month <= 12;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The parts as a day that exists, or null when one is missing or out of range. */
export function civilFromParts(parts: DateParts): CivilDate | null {
  const year = wholeNumberOrNull(parts.year);
  const month = wholeNumberOrNull(parts.month);
  const day = wholeNumberOrNull(parts.day);
  if (year === null || month === null || day === null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** This year, or next once the typed month (and day, if any) has passed. */
export function upcomingYear(
  parts: Pick<DateParts, "month" | "day">,
  today: CivilDate,
): number {
  const month = wholeNumberOrNull(parts.month);
  const day = wholeNumberOrNull(parts.day);
  if (month === null || month < 1 || month > 12) return today.year;
  const passed =
    month < today.month ||
    (month === today.month && day !== null && day < today.day);
  return passed ? today.year + 1 : today.year;
}

/**
 * A reminder's due date as the form holds it. `yearTouched` is whether the user
 * has typed a year; until they do, the year follows the month and day.
 */
export interface DueDateDraft {
  parts: DateParts;
  yearTouched: boolean;
}

export function dueDateDraft(
  dueMs: number | null,
  now: number = Date.now(),
): DueDateDraft {
  if (dueMs === null) {
    return {
      parts: { month: "", day: "", year: String(todayCivil(now).year) },
      yearTouched: false,
    };
  }
  const { year, month, day } = civilFromDueMs(dueMs);
  return {
    parts: { month: String(month), day: String(day), year: String(year) },
    yearTouched: false,
  };
}

/** Apply an edit, moving an untouched year to the next time the date comes round. */
export function editDueDate(
  draft: DueDateDraft,
  next: DateParts,
  now: number = Date.now(),
): DueDateDraft {
  const yearTouched = draft.yearTouched || next.year !== draft.parts.year;
  if (yearTouched) return { parts: next, yearTouched };
  const year = String(upcomingYear(next, todayCivil(now)));
  return { parts: { ...next, year }, yearTouched };
}

export type DueDateCheck =
  | { ok: true; dueMs: number | null }
  | { ok: false; problem: "invalid" | "past" };

/**
 * The typed due date as the value to store. No month and no day means no due
 * date. A past day is refused unless it is the one already saved.
 */
export function checkDueDate(
  parts: DateParts,
  savedDueMs: number | null,
  now: number = Date.now(),
): DueDateCheck {
  if (parts.month.trim() === "" && parts.day.trim() === "") {
    return { ok: true, dueMs: null };
  }
  const civil = civilFromParts(parts);
  if (civil === null) return { ok: false, problem: "invalid" };
  const dueMs = dueDateMs(civil);
  if (dueMs !== savedDueMs && daysUntil(todayCivil(now), civil) < 0) {
    return { ok: false, problem: "past" };
  }
  return { ok: true, dueMs };
}
