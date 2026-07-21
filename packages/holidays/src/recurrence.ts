/**
 * How a holiday recurs, and the date math that turns a rule into the concrete
 * civil days it lands on in a given year.
 *
 * Five shapes, one discriminated union (plans/holidays/research.md §2.8). Four
 * are self-contained arithmetic; `offset` is the only one that depends on
 * another entry, and it takes a resolver callback so the dependency graph (and
 * its acyclicity) stays the resolver's problem, not this module's.
 *
 * **Every rule answers with an *array*, never a single date.** A lunisolar
 * holiday can occur twice in one Gregorian year — Ramadan did in 1997 — and a
 * rule can equally answer with nothing (a leap-day holiday in a common year, a
 * table past its horizon). The array is what makes both expressible, and it is
 * why a holiday reminder keys its identity on the occurrence *date* rather than
 * the year (research §3).
 *
 * The rule travels between devices as an opaque JSON string on the holiday row
 * (see `holidaySchema` in `@leapsake/schema`), so two properties matter here:
 *
 * - {@link parseRecurrence} **never throws and never guesses** — an unknown
 *   `type`, a malformed payload, or a rule shape written by a *newer* build than
 *   this one all return `null`, and a `null` rule yields no occurrences. That is
 *   research §3's "unresolvable holiday → keep the row, generate nothing",
 *   including its rule-type-skew case: data syncs, code does not.
 * - {@link canonicalRecurrenceJson} is the **only** way a rule becomes bytes.
 *   Whole-row LWW breaks ties on canonical serialization (`resolveMerge` in
 *   `@leapsake/schema`), so two devices seeding the same catalog entry must
 *   produce byte-identical strings or they will flap against each other forever.
 */

import type { CivilDate } from "@leapsake/schema";

/** Sunday = 0, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Which occurrence of a weekday within the month; `-1` means the last one. */
export type NthWeekday = 1 | 2 | 3 | 4 | 5 | -1;

/**
 * What a `fixed` rule does when its (month, day) doesn't exist in the target
 * year — which today means exactly Feb 29 in a common year.
 *
 * The default is **`skip`**, deliberately the opposite of the milestone
 * convention in `nextOccurrence` (`@leapsake/schema`), which clamps Feb 29 to
 * Feb 28. That clamp is right for a birthday — you still want to be wished — and
 * wrong for a holiday that genuinely only exists every four years, which should
 * simply not occur. Clamp-vs-skip is therefore a property of the rule, not a
 * global convention (research §3).
 */
export type InvalidDatePolicy = "clamp" | "skip";

/** The algorithms {@link ComputedRecurrence} can name. */
export type ComputedAlgorithm = "western-easter";

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
  /**
   * Explicit `YYYY-MM-DD` occurrence dates, ascending. The escape hatch for
   * lunar and lunisolar holidays, whose dates depend on observation or on
   * calendar algorithms too heavy to bundle (research §2.8). It degrades
   * honestly: past the last entry the holiday stops occurring rather than
   * occurring on a wrong day.
   */
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

/** Parse a `YYYY-MM-DD` string into a {@link CivilDate}, or `null` if malformed. */
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

/** Render a {@link CivilDate} as `YYYY-MM-DD` — the key a holiday reminder id uses. */
export function isoFromCivil(date: CivilDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

/**
 * The Gregorian date of Western (Roman Rite) Easter Sunday, by the anonymous
 * Gregorian computus — exact for every year in the Gregorian calendar, so no
 * table and no calendar library. Orthodox Easter is a *separate catalog entry*
 * with its own rule, not a variant of this one (research §2.13: separate entries
 * per variant keep each entry's rule single-valued).
 */
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

/**
 * The date of the `nth` `weekday` of a month, or `null` when the month has no
 * such occurrence (a 5th Monday in a month with only four).
 *
 * `nth: -1` means the *last* one, which is how "last Monday in May" (Memorial
 * Day) is expressed — the shape that motivated allowing a negative index at all.
 */
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

/**
 * Resolve one entry's occurrences in `year`, delegating an `offset` rule's base
 * to `resolveBase`. A `null` rule (unparseable, or a shape this build doesn't
 * know) yields `[]` rather than throwing.
 *
 * `resolveBase` is supplied by the resolver, which owns memoization and cycle
 * detection; it returns `[]` for a base it cannot resolve, so a broken
 * dependency degrades to "no occurrences" exactly like any other unresolvable
 * rule.
 */
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
      return [westernEaster(year)];
    case "offset": {
      // Widen the search a year either side before shifting: an offset that
      // crosses a year boundary (Good Friday from an Easter in the next year, a
      // large positive offset from a December base) would otherwise be dropped
      // by the filter below. Cheap, and it makes the sign of `days` irrelevant.
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

/**
 * Serialize a rule to the exact bytes stored on the holiday row — sorted keys,
 * no whitespace, and **defaults written explicitly** so that an author who omits
 * `onInvalidDate` and one who spells out `"skip"` produce the same string.
 *
 * This is the single writer. Whole-row LWW tie-breaks on canonical
 * serialization (`resolveMerge`), so a rule that serializes two ways is a rule
 * that can flap between devices forever; a snapshot test over the whole catalog
 * pins the output. Never re-serialize a rule read back from the database — the
 * stored string is authoritative and is passed through verbatim.
 */
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

/**
 * Read a stored rule string back into a {@link HolidayRecurrence}, or `null` if
 * this build cannot make sense of it.
 *
 * Total by construction: malformed JSON, an unknown `type`, an out-of-range
 * field, or a rule authored by a newer build all answer `null`, and a `null`
 * rule generates nothing. That is what lets a device relay a holiday it does not
 * itself understand — the row survives, only its occurrences don't (research
 * §3). Validated by hand rather than by Zod so the failure is a value, not a
 * thrown error, and so this package keeps its single dependency.
 */
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
      if (r.algorithm !== "western-easter") return null;
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
