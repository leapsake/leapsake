// `@leapsake/holidays`: the catalog, the recurrence engine and the API; see
// the README's code map.
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
