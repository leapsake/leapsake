// How a holiday recurs, and the days a rule lands on in a year. Every rule
// answers with an array: a year may hold two occurrences, or none.

import type { CivilDate } from "@leapsake/schema";

/** Sunday = 0, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday within the month; `-1` means the last one. */
export type NthWeekday = 1 | 2 | 3 | 4 | 5 | -1;

/** What a `fixed` rule does with Feb 29 in a common year; `skip` by default,
 *  unlike a birthday's clamp. */
export type InvalidDatePolicy = "clamp" | "skip";

/** The algorithms {@link ComputedRecurrence} can name; never reuse a name. */
export type ComputedAlgorithm = "western-easter" | "orthodox-easter";

export interface FixedRecurrence {
  type: "fixed";
  /** 1–12. */
  month: number;
  /** 1–31. */
  day: number;
  onInvalidDate?: InvalidDatePolicy;
}

export interface NthWeekdayRecurrence {
  type: "nth-weekday";
  /** 1–12. */
  month: number;
  weekday: Weekday;
  nth: NthWeekday;
}

export interface ComputedRecurrence {
  type: "computed";
  algorithm: ComputedAlgorithm;
}

export interface OffsetRecurrence {
  type: "offset";
  /** The slug of the entry this one is measured from. */
  from: string;
  /** Days to add to the base occurrence; negative shifts earlier. */
  days: number;
}

export interface TableRecurrence {
  type: "table";
  /** Explicit `YYYY-MM-DD` dates, ascending; past the last, no occurrence. */
  dates: readonly string[];
}

export type HolidayRecurrence =
  | FixedRecurrence
  | NthWeekdayRecurrence
  | ComputedRecurrence
  | OffsetRecurrence
  | TableRecurrence;

/** Days in a (1-based) month, proleptic Gregorian. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD` into a {@link CivilDate}, or `null` if malformed. */
export function civilFromIso(iso: string): CivilDate | null {
  const m = ISO_DATE.exec(iso);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A {@link CivilDate} as `YYYY-MM-DD`, as a holiday reminder id keys it. */
export function isoFromCivil(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/** Western Easter Sunday by the anonymous Gregorian computus, exact for
 *  every Gregorian year. */
export function westernEaster(year: number): CivilDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return { year, month: Math.floor(n / 31), day: (n % 31) + 1 };
}

/** The fixed-day number of 1 January 2000, anchoring both converters. */
const RD_2000 = 730120;

/** The civil (proleptic Gregorian) date of a fixed-day number. */
function civilFromFixed(rd: number): CivilDate {
  const d = new Date(Date.UTC(2000, 0, 1) + (rd - RD_2000) * 86400000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** The fixed-day number of a date in the **Julian** calendar. */
function fixedFromJulian(year: number, month: number, day: number): number {
  // Julian leap years are simply every fourth, with no century rule.
  const correction = month <= 2 ? 0 : year % 4 === 0 ? -1 : -2;
  return (
    -2 +
    365 * (year - 1) +
    Math.floor((year - 1) / 4) +
    Math.floor((367 * month - 362) / 12) +
    correction +
    day
  );
}

/** Orthodox Easter by Meeus' Julian algorithm, converted via a fixed-day
 *  number: the Julian gap grows to 14 days in 2100. */
export function orthodoxEaster(year: number): CivilDate {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  return civilFromFixed(fixedFromJulian(year, month, day));
}

/** The `nth` `weekday` of a month, `-1` being the last, or `null` if absent. */
export function nthWeekdayOf(
  year: number,
  month: number,
  weekday: Weekday,
  nth: NthWeekday,
): CivilDate | null {
  const last = daysInMonth(year, month);
  if (nth === -1) {
    const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
    return { year, month, day: last - ((lastWeekday - weekday + 7) % 7) };
  }
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + 7 * (nth - 1);
  return day > last ? null : { year, month, day };
}

/** One entry's occurrences in `year`, an `offset` base through `resolveBase`;
 *  a `null` rule or broken base yields `[]`. */
export function occurrencesInYear(
  rule: HolidayRecurrence | null,
  year: number,
  resolveBase: (slug: string, year: number) => readonly CivilDate[],
): CivilDate[] {
  if (rule === null) return [];
  switch (rule.type) {
    case "fixed": {
      const { month, day } = rule;
      if (month < 1 || month > 12 || day < 1 || day > 31) return [];
      const last = daysInMonth(year, month);
      if (day <= last) return [{ year, month, day }];
      // The date doesn't exist this year (Feb 29 in a common year).
      return (rule.onInvalidDate ?? "skip") === "clamp"
        ? [{ year, month, day: last }]
        : [];
    }
    case "nth-weekday": {
      if (rule.month < 1 || rule.month > 12) return [];
      const date = nthWeekdayOf(year, rule.month, rule.weekday, rule.nth);
      return date === null ? [] : [date];
    }
    case "computed":
      // Exhaustive, so a new algorithm fails to compile, not falls through.
      switch (rule.algorithm) {
        case "western-easter":
          return [westernEaster(year)];
        case "orthodox-easter":
          return [orthodoxEaster(year)];
      }
    case "offset": {
      // A year either side, so an offset crossing a year boundary survives
      // the filter below.
      const out: CivilDate[] = [];
      for (const baseYear of [year - 1, year, year + 1]) {
        for (const base of resolveBase(rule.from, baseYear)) {
          out.push(shiftDays(base, rule.days));
        }
      }
      return sortDates(out.filter((d) => d.year === year));
    }
    case "table": {
      const out: CivilDate[] = [];
      for (const iso of rule.dates) {
        const date = civilFromIso(iso);
        if (date !== null && date.year === year) out.push(date);
      }
      return sortDates(out);
    }
  }
}

/** Move a civil date by whole days, rolling over month and year boundaries. */
export function shiftDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function sortDates(dates: CivilDate[]): CivilDate[] {
  return dates.sort(
    (a, b) =>
      Date.UTC(a.year, a.month - 1, a.day) -
      Date.UTC(b.year, b.month - 1, b.day),
  );
}

/** The only way a rule becomes bytes: sorted keys, no whitespace, defaults
 *  written out. See the README's invariants. */
export function canonicalRecurrenceJson(rule: HolidayRecurrence): string {
  switch (rule.type) {
    case "fixed":
      return stable({
        day: rule.day,
        month: rule.month,
        onInvalidDate: rule.onInvalidDate ?? "skip",
        type: rule.type,
      });
    case "nth-weekday":
      return stable({
        month: rule.month,
        nth: rule.nth,
        type: rule.type,
        weekday: rule.weekday,
      });
    case "computed":
      return stable({ algorithm: rule.algorithm, type: rule.type });
    case "offset":
      return stable({ days: rule.days, from: rule.from, type: rule.type });
    case "table":
      return stable({ dates: [...rule.dates], type: rule.type });
  }
}

/** `JSON.stringify` with object keys emitted in sorted order, recursively. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A stored rule, or `null` for anything this build can't read; never throws,
 *  so hand-validated rather than by Zod. */
export function parseRecurrence(json: string): HolidayRecurrence | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  switch (r.type) {
    case "fixed": {
      if (!isMonth(r.month) || !isInt(r.day, 1, 31)) return null;
      const policy = r.onInvalidDate;
      if (policy !== undefined && policy !== "clamp" && policy !== "skip") {
        return null;
      }
      return {
        type: "fixed",
        month: r.month,
        day: r.day,
        onInvalidDate: policy ?? "skip",
      };
    }
    case "nth-weekday": {
      if (!isMonth(r.month) || !isInt(r.weekday, 0, 6)) return null;
      const nth = r.nth;
      if (!isInt(nth, 1, 5) && nth !== -1) return null;
      return {
        type: "nth-weekday",
        month: r.month,
        weekday: r.weekday as Weekday,
        nth: nth as NthWeekday,
      };
    }
    case "computed": {
      if (
        r.algorithm !== "western-easter" &&
        r.algorithm !== "orthodox-easter"
      ) {
        return null;
      }
      return { type: "computed", algorithm: r.algorithm };
    }
    case "offset": {
      if (typeof r.from !== "string" || r.from.length === 0) return null;
      if (!isInt(r.days, -366, 366)) return null;
      return { type: "offset", from: r.from, days: r.days };
    }
    case "table": {
      if (!Array.isArray(r.dates)) return null;
      const dates: string[] = [];
      for (const d of r.dates) {
        if (typeof d !== "string" || civilFromIso(d) === null) return null;
        dates.push(d);
      }
      return { type: "table", dates };
    }
    default:
      return null;
  }
}

function isInt(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function isMonth(v: unknown): v is number {
  return isInt(v, 1, 12);
}
