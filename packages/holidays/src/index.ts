/**
 * `@leapsake/holidays` — everything Holidays is: the bundled **catalog**, the
 * **recurrence engine** that turns a catalog entry into the concrete days it
 * falls on, and the repo-backed **API** the composition root hands to clients.
 *
 * The catalog and the engine touch no database. {@link seedHolidayCatalog} and
 * {@link createHolidaysApi} do, through repo ports injected from
 * `@leapsake/data` — the resolver is built over the *rows*, so the same engine
 * answers for bundled, user-defined and synced-from-another-device holidays
 * alike. Never depends on `@leapsake/core`.
 *
 * Deliberately *not* here: the holiday/observance **row schemas**, which live in
 * `@leapsake/schema` because `defineSyncable` derives its columns from a Zod
 * `.shape` and `@leapsake/data` cannot depend on this package. The seam between
 * the two is the `recurrence` column, which travels as an opaque string and is
 * parsed here — see {@link parseRecurrence} for why that indirection is what
 * makes a device able to relay a holiday it does not itself understand.
 */
export { CATALOG, CATALOG_VERSION, classificationFor } from "./catalog.js";
export type {
  HolidayClassification,
  HolidayEntry,
  HolidayRegion,
  HolidayTradition,
} from "./catalog.js";
export {
  canonicalRecurrenceJson,
  civilFromIso,
  daysInMonth,
  isoFromCivil,
  nthWeekdayOf,
  occurrencesInYear,
  orthodoxEaster,
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
export { createHolidaysApi, holidayReminderCandidates } from "./api.js";
export type {
  BearerHolidayCandidate,
  HolidayDetail,
  HolidayListItem,
  HolidayObserverCandidate,
  HolidaysApiDeps,
  ObserverDecision,
} from "./api.js";
export { seedHolidayCatalog } from "./seed.js";
