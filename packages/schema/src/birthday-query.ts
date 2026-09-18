import { fold } from "./search-fold.js";

/** A partial date parsed from a query: any subset of `(year, month, day)`. */
export interface PartialDate {
  year?: number;
  month?: number;
  day?: number;
}

/** English month names and 3-letter abbreviations, to 1–12. */
const MONTH_LOOKUP: Map<string, number> = (() => {
  const names = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const m = new Map<string, number>();
  names.forEach((name, i) => {
    m.set(name, i + 1);
    m.set(name.slice(0, 3), i + 1);
  });
  return m;
})();

const isMonth = (n: number): boolean => n >= 1 && n <= 12;
const isDay = (n: number): boolean => n >= 1 && n <= 31;
const isYear = (n: number): boolean => n >= 1000 && n <= 9999;

/**
 * The partial dates a search term could mean, or `[]`. "3/4" yields both
 * March 4 and April 3; a bare "4" yields nothing.
 */
export function parseBirthdayQuery(term: string): PartialDate[] {
  const t = fold(term).trim();
  if (t === "") return [];

  // A month name, then an optional day and year: "mar 4", "march 4 1990".
  const named = /^([a-z]+)\b[\s,]*(\d{1,2})?[\s,]*(\d{4})?$/.exec(t);
  if (named) {
    const month = MONTH_LOOKUP.get(named[1]);
    if (month !== undefined) {
      const date: PartialDate = { month };
      if (named[2] !== undefined) {
        const day = Number(named[2]);
        if (!isDay(day)) return [];
        date.day = day;
      }
      if (named[3] !== undefined) date.year = Number(named[3]);
      return [date];
    }
    return []; // an unrecognized word is not a date
  }

  // Numeric M/D[/Y] separated by "/" or "-". Emit both orderings.
  const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(t);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = numeric[3] !== undefined ? Number(numeric[3]) : undefined;
    const candidates: PartialDate[] = [];
    const add = (month: number, day: number) => {
      if (isMonth(month) && isDay(day)) {
        candidates.push(
          year !== undefined ? { month, day, year } : { month, day },
        );
      }
    };
    add(a, b); // M/D
    if (a !== b) add(b, a); // D/M (skip when identical, e.g. "4/4")
    return candidates;
  }

  // A lone 4-digit year.
  const yearOnly = /^(\d{4})$/.exec(t);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return isYear(year) ? [{ year }] : [];
  }

  return [];
}
