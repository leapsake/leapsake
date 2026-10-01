import {
  type CivilDate,
  type DateParts,
  todayCivil,
  wholeNumberOrNull,
} from "@leapsake/schema";

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
 * A due date as the fields hold it. Until the user types a year
 * (`yearTouched`), the year follows the month and day.
 */
export interface DueDateDraft {
  parts: DateParts;
  yearTouched: boolean;
}

/** Apply an edit; an untouched year follows the date to its next time. */
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

/** Whether a typed month or day can take no further digit that would make
 *  sense: two digits, or one no valid two-digit value starts with. */
export function datePartFinished(part: keyof DateParts, text: string): boolean {
  if (part === "year") return text.length >= 4;
  if (text.length >= 2) return true;
  const firstOfTwoDigits = part === "month" ? 1 : 3;
  return /^\d$/.test(text) && Number(text) > firstOfTwoDigits;
}
