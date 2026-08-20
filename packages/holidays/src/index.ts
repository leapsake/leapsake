/**
 * `@leapsake/holidays` — the holiday **catalog** and the **recurrence engine**
 * that turns a catalog entry into the concrete days it falls on, kept as its own
 * narrowly-scoped, independently-testable unit outside `@leapsake/core`.
 *
 * It depends only on `@leapsake/schema` (the civil-date primitives) — never on
 * `@leapsake/core` or `@leapsake/data`, and it touches no database. The
 * composition root (`@leapsake/core`) seeds the catalog into the synced
 * `holidays` table and builds a resolver over the rows it reads back, so the
 * same engine answers for bundled and user-defined holidays alike.
 *
 * Deliberately *not* here: the holiday/observance **row schemas**, which live in
 * `@leapsake/schema` because `defineSyncable` derives its columns from a Zod
 * `.shape` and `@leapsake/data` cannot depend on this package. The seam between
 * the two is the `recurrence` column, which travels as an opaque string and is
 * parsed here — see {@link parseRecurrence} for why that indirection is what
 * makes a device able to relay a holiday it does not itself understand.
 */
export { CATALOG, CATALOG_VERSION, isGiftGivingHoliday } from "./catalog.js";
export type { HolidayEntry } from "./catalog.js";
export {
  canonicalRecurrenceJson,
  civilFromIso,
  daysInMonth,
  isoFromCivil,
  nthWeekdayOf,
  occurrencesInYear,
  parseRecurrence,
  shiftDays,
  westernEaster,
} from "./recurrence.js";
export type {
  ComputedAlgorithm,
  ComputedRecurrence,
  FixedRecurrence,
  HolidayRecurrence,
  InvalidDatePolicy,
  NthWeekday,
  NthWeekdayRecurrence,
  OffsetRecurrence,
  TableRecurrence,
  Weekday,
} from "./recurrence.js";
export { createHolidayResolver } from "./resolver.js";
export type {
  HolidayResolver,
  HolidayResolverOptions,
  ResolvableHoliday,
} from "./resolver.js";
