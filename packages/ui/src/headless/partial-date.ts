/**
 * The partial-date form logic both renderers share.
 *
 * A date the user types is three independent strings, and the rules for turning
 * them into something storable — blank means absent, a lone day is dropped, a
 * non-positive integer is not a date — are domain rules rather than markup. They
 * live here so the web fields and the React Native fields cannot drift on what
 * “25, no month” means; before this they were two hand-kept copies, and only one
 * of them was under test.
 */

/** A partial date, as stored. */
export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** A partial date as typed — strings so an empty input stays empty, not 0/NaN. */
export interface DateFields {
  year: string;
  month: string;
  day: string;
}

export const emptyDate = (): DateFields => ({ year: "", month: "", day: "" });

/**
 * A typed date part as a positive integer, or null when blank/unparseable.
 *
 * Exported because the fields also read the year on its own, to resolve a
 * holiday's real date in that year — the one part a form needs before the whole
 * date parses.
 */
export function datePart(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The typed fields as a partial date, or null when wholly blank. A lone day (no
 * month) drops the day — the schema's day⇒month rule, mirrored here so the form
 * only submits values the schema will accept.
 */
export function parseDateFields(d: DateFields): PartialDate | null {
  const year = datePart(d.year);
  const month = datePart(d.month);
  const day = month !== null ? datePart(d.day) : null;
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** A stored partial date back into typed fields (for an edit form's initial state). */
export function dateFieldsOf(d: PartialDate): DateFields {
  return {
    year: d.year?.toString() ?? "",
    month: d.month?.toString() ?? "",
    day: d.day?.toString() ?? "",
  };
}
