// The partial-date form logic both renderers share.

/** A partial date, as stored. */
export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** A partial date as typed: strings, so an empty input stays empty. */
export interface DateFields {
  year: string;
  month: string;
  day: string;
}

export const emptyDate = (): DateFields => ({ year: "", month: "", day: "" });

/** A typed date part as a positive integer, or null when blank or invalid. */
export function datePart(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isInteger(n) && n > 0 ? n : null;
}

/** The typed fields as a partial date, or null when blank; a lone day is
 *  dropped, as the schema requires a month with a day. */
export function parseDateFields(d: DateFields): PartialDate | null {
  const year = datePart(d.year);
  const month = datePart(d.month);
  const day = month !== null ? datePart(d.day) : null;
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** A stored partial date back into typed fields, for an edit form. */
export function dateFieldsOf(d: PartialDate): DateFields {
  return {
    year: d.year?.toString() ?? "",
    month: d.month?.toString() ?? "",
    day: d.day?.toString() ?? "",
  };
}
