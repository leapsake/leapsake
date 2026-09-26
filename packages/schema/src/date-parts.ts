import {
  type CivilDate,
  daysUntil,
  dueDateMs,
  isoFromDueMs,
  todayCivil,
} from "./reminder-schedule.js";

/** A date as typed: each part a string, nothing parsed. */
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

/** The parts as a day that exists, or null if one is missing or invalid. */
export function civilFromParts(parts: DateParts): CivilDate | null {
  const year = wholeNumberOrNull(parts.year);
  const month = wholeNumberOrNull(parts.month);
  const day = wholeNumberOrNull(parts.day);
  if (year === null || month === null || day === null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` for a day that exists, else "" — what a date input holds. */
export function isoFromParts(parts: DateParts): string {
  const civil = civilFromParts(parts);
  if (civil === null) return "";
  return `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
}

/** A date input's `YYYY-MM-DD` as parts; anything else is all blank. */
export function partsFromIso(iso: string): DateParts {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) return { month: "", day: "", year: "" };
  return { month: String(Number(m[2])), day: String(Number(m[3])), year: m[1] };
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

/** The earliest day {@link checkDueDate} accepts, as a date input's `min`. */
export function earliestDueIso(
  savedDueMs: number | null,
  now: number = Date.now(),
): string {
  const today = dueDateMs(todayCivil(now));
  return isoFromDueMs(Math.min(today, savedDueMs ?? today));
}
