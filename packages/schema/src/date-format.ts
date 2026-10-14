import { z } from "zod";

/** Every date format a user may pick, each spelled as its placeholder. */
export const DATE_FORMATS = [
  "Month D, YYYY",
  "D Month YYYY",
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "DD.MM.YYYY",
  "DD-MM-YYYY",
  "YYYY-MM-DD",
  "YYYY/MM/DD",
  "YYYY.MM.DD",
] as const;

export const dateFormatSchema = z.enum(DATE_FORMATS);

export type DateFormat = z.infer<typeof dateFormatSchema>;

/** What a date shows with no preference set and no region known. */
export const FALLBACK_DATE_FORMAT: DateFormat = "Month D, YYYY";

/** Regions that write the month first. */
const MONTH_FIRST = new Set([
  "US",
  "AS",
  "GU",
  "MP",
  "PR",
  "UM",
  "VI",
  "FM",
  "MH",
  "PW",
  "PH",
  "CA",
]);

/** Regions that write the year first, by the separator they use. */
const YEAR_FIRST: Record<string, DateFormat> = {
  CN: "YYYY-MM-DD",
  MN: "YYYY-MM-DD",
  BT: "YYYY-MM-DD",
  KP: "YYYY-MM-DD",
  LT: "YYYY-MM-DD",
  SE: "YYYY-MM-DD",
  JP: "YYYY/MM/DD",
  TW: "YYYY/MM/DD",
  KR: "YYYY.MM.DD",
  HU: "YYYY.MM.DD",
};

/**
 * The format a region reads most easily: words in its order where English has
 * them, else its own digits. `region` is an ISO 3166 code.
 */
export function defaultDateFormat(region: string | null): DateFormat {
  if (region === null) return FALLBACK_DATE_FORMAT;
  const code = region.toUpperCase();
  if (MONTH_FIRST.has(code)) return "Month D, YYYY";
  return YEAR_FIRST[code] ?? "D Month YYYY";
}

/** Localized month names, January first. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  }),
);

/** A month's localized name, `month` 1-based. */
export function monthName(month: number): string {
  return MONTH_NAMES[month - 1];
}

/** Whether a format puts the day before the month. */
function dayFirst(format: DateFormat): boolean {
  return format.startsWith("D");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** A whole date in `format`: "November 9, 2026", "09.11.2026", "2026/11/09". */
export function formatDate(
  date: { year: number; month: number; day: number },
  format: DateFormat,
): string {
  const { year, month, day } = date;
  const [mm, dd] = [pad2(month), pad2(day)];
  switch (format) {
    case "Month D, YYYY":
      return `${monthName(month)} ${day}, ${year}`;
    case "D Month YYYY":
      return `${day} ${monthName(month)} ${year}`;
    case "MM/DD/YYYY":
      return `${mm}/${dd}/${year}`;
    case "DD/MM/YYYY":
      return `${dd}/${mm}/${year}`;
    case "DD.MM.YYYY":
      return `${dd}.${mm}.${year}`;
    case "DD-MM-YYYY":
      return `${dd}-${mm}-${year}`;
    case "YYYY-MM-DD":
      return `${year}-${mm}-${dd}`;
    case "YYYY/MM/DD":
      return `${year}/${mm}/${dd}`;
    case "YYYY.MM.DD":
      return `${year}.${mm}.${dd}`;
  }
}

/** A date missing parts, in words so it never reads ambiguously ("March 9" or
 *  "9 March" by the format's order); a whole date as {@link formatDate}. */
export function formatPartialDate(
  date: { year: number | null; month: number | null; day: number | null },
  format: DateFormat,
): string {
  const { year, month, day } = date;
  if (month === null) return year === null ? "" : String(year);
  if (day === null)
    return year === null ? monthName(month) : `${monthName(month)} ${year}`;
  if (year !== null) return formatDate({ year, month, day }, format);
  return dayFirst(format)
    ? `${day} ${monthName(month)}`
    : `${monthName(month)} ${day}`;
}
