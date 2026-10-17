// The bundled catalog, as TypeScript so a typo is a compile error. Read the
// README's _Editing the catalog_ before changing an entry.

import {
  type HolidayAffiliations,
  countries,
  everywhereBut,
  religion,
} from "./affiliation.js";
import type { HolidayRecurrence } from "./recurrence.js";

/** The tradition an occasion comes from, or `secular`: provenance, never a
 *  claim about who observes it. */
export type HolidayTradition =
  | "secular"
  | "christian"
  | "jewish"
  | "muslim"
  | "hindu"
  | "buddhist"
  | "sikh"
  | "chinese";

/** Where an entry is nationally observed, or `global`, as every religious
 *  holiday is. */
export type HolidayRegion =
  | "global"
  | "us"
  | "ca"
  | "mx"
  | "uk"
  | "ie"
  | "fr"
  | "au";

/** An errand of your own for a holiday, and how many days ahead it's due. */
export interface HolidaySuggestion {
  label: string;
  offsetDays: number;
}

/** A catalog entry before it becomes a row, its recurrence not yet
 *  serialized. */
export interface HolidayEntry {
  /** Stable, human-readable identity; the row's UUID is derived from it. */
  slug: string;
  name: string;
  /** The phrase “Wish @Violet …” takes, with its own article if any; see
   *  the README on greetings. */
  greeting: string;
  /** Beside its name where it asks or reminds, “🎃”. */
  icon: string;
  recurrence: HolidayRecurrence;
  /** The tradition this occasion comes from. See {@link HolidayTradition}. */
  tradition: HolidayTradition;
  /** Where it is nationally observed. See {@link HolidayRegion}. */
  region: HolidayRegion;
  /** Who keeps it, which makes them observe it implicitly. Bundle-side,
   *  like {@link tradition}. */
  affiliations: HolidayAffiliations;
  /** Days a multi-day holiday lasts, for display; it anchors to the start. */
  durationDays?: number;
  /** Groups the same idea under different rules, for display and picker
   *  dedup only. */
  familyId?: string;
  /** Whether a US user's own locale implies it. Unused; locale relevance
   *  should key on {@link region}. */
  impliedByLocale?: boolean;
  /** When this entry was last authored, epoch ms; see the README. */
  authoredAt: number;
  /** Set instead of deleting; seeds as a tombstone. */
  retiredAt?: number;
  /** Whether every observer is wished it until a schedule is stored for
   *  them. Bundle-side, like {@link affiliations}. */
  wishByDefault?: true;
  /** At most three errands of your own the prompt offers, if you keep it. */
  suggestions?: readonly HolidaySuggestion[];
}

/** An authored ISO date as epoch ms, readable in a diff. */
function authored(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const V1 = authored("2026-07-20");
const V2 = authored("2026-07-23");
const V3 = authored("2026-09-11");

// Kept as a public holiday by everyone, not only by Christians.
const CHRISTMAS_COUNTRIES = [
  "US",
  "CA",
  "MX",
  "GB",
  "IE",
  "FR",
  "DE",
  "AT",
  "CH",
  "BE",
  "NL",
  "LU",
  "DK",
  "NO",
  "SE",
  "FI",
  "IS",
  "IT",
  "ES",
  "PT",
  "MT",
  "PL",
  "CZ",
  "SK",
  "HU",
  "SI",
  "HR",
  "LT",
  "LV",
  "EE",
  "GR",
  "CY",
  "RO",
  "BG",
  "AU",
  "NZ",
  "ZA",
  "BR",
  "AR",
  "CL",
  "CO",
  "PE",
  "VE",
  "UY",
  "PY",
  "BO",
  "EC",
  "PH",
];

// Countries whose churches keep the Julian Christmas, on 7 January.
const ORTHODOX_CHRISTMAS = countries(
  "RU",
  "BY",
  "RS",
  "ME",
  "MK",
  "GE",
  "EG",
  "ET",
  "ER",
  "KZ",
);

// Countries whose churches keep the Orthodox Easter.
const ORTHODOX_EASTER = countries(
  "GR",
  "CY",
  "RU",
  "UA",
  "BY",
  "RS",
  "ME",
  "MK",
  "BG",
  "RO",
  "GE",
  "MD",
  "EG",
  "ET",
  "ER",
  "KZ",
);

const GATHERING = [{ label: "🎉 Plan a gathering", offsetDays: 14 }] as const;

// Observing it means being the one celebrated, which no affiliation says.
const KEPT_BY_WHOEVER_YOU_SAY = countries();

const CHINESE_FESTIVAL = countries("CN", "TW", "HK", "MO", "SG", "MY");

/** Bump on any change to {@link CATALOG}; an integer, not semver. */
export const CATALOG_VERSION = 4;

/** The catalog; its lunisolar tables run to 2056, derived as the README's
 *  _How the lunisolar tables were derived_ says. */
export const CATALOG: readonly HolidayEntry[] = [
  // ── Fixed date ────────────────────────────────────────────────────────────
  {
    slug: "new-years-day",
    name: "New Year's Day",
    icon: "🎆",
    greeting: "a Happy New Year",
    recurrence: { type: "fixed", month: 1, day: 1 },
    tradition: "secular",
    region: "global",
    affiliations: everywhereBut("AF", "IR", "SA"),
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "new-years-eve",
    name: "New Year's Eve",
    icon: "🥂",
    greeting: "a Happy New Year",
    recurrence: { type: "fixed", month: 12, day: 31 },
    tradition: "secular",
    region: "global",
    affiliations: everywhereBut("AF", "IR", "SA"),
    suggestions: [{ label: "🥂 Make New Year’s Eve plans", offsetDays: 14 }],
    familyId: "new-year",
    authoredAt: V3,
  },
  {
    slug: "orthodox-christmas",
    name: "Orthodox Christmas",
    icon: "🎄",
    greeting: "a Merry Christmas",
    // Julian 25 December is Gregorian 7 January throughout 1900–2099, so a
    // `fixed` rule is exact; it is no Julian conversion.
    recurrence: { type: "fixed", month: 1, day: 7 },
    tradition: "christian",
    region: "global",
    affiliations: ORTHODOX_CHRISTMAS,
    wishByDefault: true,
    familyId: "christmas",
    authoredAt: V3,
  },
  {
    slug: "au-australia-day",
    name: "Australia Day",
    icon: "🇦🇺",
    greeting: "a Happy Australia Day",
    recurrence: { type: "fixed", month: 1, day: 26 },
    tradition: "secular",
    region: "au",
    affiliations: countries("AU"),
    authoredAt: V3,
  },
  {
    slug: "us-valentines",
    name: "Valentine's Day",
    icon: "💘",
    greeting: "a Happy Valentine's Day",
    recurrence: { type: "fixed", month: 2, day: 14 },
    tradition: "secular",
    region: "us",
    affiliations: countries(
      "US",
      "CA",
      "MX",
      "GB",
      "IE",
      "FR",
      "DE",
      "AT",
      "CH",
      "BE",
      "NL",
      "IT",
      "ES",
      "PT",
      "PL",
      "GR",
      "AU",
      "NZ",
      "ZA",
      "AR",
      "CL",
      "PE",
      "PH",
      "JP",
      "KR",
      "CN",
      "TW",
      "SG",
      "MY",
      "IN",
    ),
    familyId: "valentines",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "intl-womens-day",
    name: "International Women's Day",
    icon: "💐",
    greeting: "a Happy International Women's Day",
    recurrence: { type: "fixed", month: 3, day: 8 },
    tradition: "secular",
    region: "global",
    affiliations: countries(
      "RU",
      "UA",
      "BY",
      "KZ",
      "UZ",
      "KG",
      "TJ",
      "TM",
      "AM",
      "AZ",
      "GE",
      "MD",
      "CN",
      "VN",
      "LA",
      "KH",
      "MN",
      "CU",
      "IT",
      "PL",
      "RO",
      "BG",
      "RS",
      "MK",
      "BA",
      "ME",
      "AL",
      "UG",
      "ZM",
      "AO",
      "BF",
      "ER",
      "GW",
      "MG",
      "NP",
    ),
    authoredAt: V3,
  },
  {
    slug: "ie-st-patricks",
    name: "St. Patrick's Day",
    icon: "☘️",
    greeting: "a Happy St. Patrick's Day",
    // `secular`: kept far more widely as a national day than a religious one.
    recurrence: { type: "fixed", month: 3, day: 17 },
    tradition: "secular",
    region: "ie",
    affiliations: countries("IE"),
    authoredAt: V3,
  },
  {
    slug: "intl-workers-day",
    name: "May Day",
    icon: "✊",
    greeting: "a Happy May Day",
    recurrence: { type: "fixed", month: 5, day: 1 },
    tradition: "secular",
    region: "global",
    affiliations: everywhereBut(
      "US",
      "CA",
      "AU",
      "NZ",
      "GB",
      "IE",
      "JP",
      "NL",
      "IL",
      "AF",
      "IR",
      "SA",
    ),
    authoredAt: V3,
  },
  {
    slug: "mx-cinco-de-mayo",
    name: "Cinco de Mayo",
    icon: "🪅",
    greeting: "a Happy Cinco de Mayo",
    recurrence: { type: "fixed", month: 5, day: 5 },
    tradition: "secular",
    region: "mx",
    affiliations: countries("MX"),
    authoredAt: V3,
  },
  {
    slug: "us-juneteenth",
    name: "Juneteenth",
    icon: "✊🏿",
    greeting: "a Happy Juneteenth",
    recurrence: { type: "fixed", month: 6, day: 19 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    authoredAt: V1,
  },
  {
    slug: "ca-canada-day",
    name: "Canada Day",
    icon: "🇨🇦",
    greeting: "a Happy Canada Day",
    recurrence: { type: "fixed", month: 7, day: 1 },
    tradition: "secular",
    region: "ca",
    affiliations: countries("CA"),
    suggestions: GATHERING,
    authoredAt: V3,
  },
  {
    slug: "us-independence-day",
    name: "Independence Day",
    icon: "🎆",
    greeting: "a Happy Fourth of July",
    recurrence: { type: "fixed", month: 7, day: 4 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    suggestions: GATHERING,
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "fr-bastille-day",
    name: "Bastille Day",
    icon: "🇫🇷",
    greeting: "a Happy Bastille Day",
    recurrence: { type: "fixed", month: 7, day: 14 },
    tradition: "secular",
    region: "fr",
    affiliations: countries("FR"),
    authoredAt: V3,
  },
  {
    slug: "mx-independence-day",
    name: "Mexican Independence Day",
    icon: "🇲🇽",
    greeting: "a Happy Independence Day",
    recurrence: { type: "fixed", month: 9, day: 16 },
    tradition: "secular",
    region: "mx",
    affiliations: countries("MX"),
    authoredAt: V3,
  },
  {
    slug: "us-halloween",
    name: "Halloween",
    icon: "🎃",
    greeting: "a Happy Halloween",
    recurrence: { type: "fixed", month: 10, day: 31 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US", "CA", "IE", "GB"),
    suggestions: [
      { label: "🎭 Plan a costume", offsetDays: 21 },
      { label: "🍬 Buy candy for trick-or-treaters", offsetDays: 7 },
    ],
    familyId: "halloween",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "mx-dia-de-muertos",
    name: "Día de los Muertos",
    icon: "💀",
    // A remembrance, and a warm one — but not "Happy".
    greeting: "a meaningful Día de los Muertos",
    recurrence: { type: "fixed", month: 11, day: 1 },
    tradition: "secular",
    region: "mx",
    affiliations: countries("MX"),
    durationDays: 2,
    authoredAt: V3,
  },
  {
    slug: "us-veterans-day",
    name: "Veterans Day",
    icon: "🎖️",
    greeting: "a Happy Veterans Day",
    recurrence: { type: "fixed", month: 11, day: 11 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    familyId: "remembrance",
    authoredAt: V3,
  },
  {
    slug: "ca-remembrance-day",
    name: "Remembrance Day",
    icon: "🌺",
    greeting: "a peaceful Remembrance Day",
    recurrence: { type: "fixed", month: 11, day: 11 },
    tradition: "secular",
    region: "ca",
    affiliations: countries("CA"),
    familyId: "remembrance",
    authoredAt: V3,
  },
  {
    slug: "christmas",
    name: "Christmas",
    icon: "🎄",
    greeting: "a Merry Christmas",
    recurrence: { type: "fixed", month: 12, day: 25 },
    tradition: "christian",
    region: "global",
    affiliations: { religions: ["christian"], countries: CHRISTMAS_COUNTRIES },
    suggestions: [{ label: "🍽️ Plan Christmas dinner", offsetDays: 21 }],
    wishByDefault: true,
    familyId: "christmas",
    // Safe to imply from a US locale: an occasion, not a religion.
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "uk-boxing-day",
    name: "Boxing Day",
    icon: "🎁",
    greeting: "a Happy Boxing Day",
    recurrence: { type: "fixed", month: 12, day: 26 },
    tradition: "secular",
    region: "uk",
    affiliations: countries("GB", "IE", "CA", "AU", "NZ", "ZA"),
    authoredAt: V3,
  },

  // ── Nth weekday of month ──────────────────────────────────────────────────
  {
    slug: "us-mlk-day",
    name: "Martin Luther King Jr. Day",
    icon: "🕊️",
    greeting: "a meaningful Martin Luther King Jr. Day",
    // Third Monday in January.
    recurrence: { type: "nth-weekday", month: 1, weekday: 1, nth: 3 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    authoredAt: V3,
  },
  {
    slug: "us-presidents-day",
    name: "Presidents' Day",
    icon: "🏛️",
    greeting: "a Happy Presidents' Day",
    // Third Monday in February.
    recurrence: { type: "nth-weekday", month: 2, weekday: 1, nth: 3 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    authoredAt: V3,
  },
  {
    slug: "us-mothers-day",
    name: "Mother's Day",
    icon: "💐",
    greeting: "a Happy Mother's Day",
    // Second Sunday in May.
    recurrence: { type: "nth-weekday", month: 5, weekday: 0, nth: 2 },
    tradition: "secular",
    region: "us",
    affiliations: KEPT_BY_WHOEVER_YOU_SAY,
    familyId: "mothers-day",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-memorial-day",
    name: "Memorial Day",
    icon: "🇺🇸",
    greeting: "a peaceful Memorial Day",
    // Last Monday in May — the shape `nth: -1` exists for.
    recurrence: { type: "nth-weekday", month: 5, weekday: 1, nth: -1 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    // Not in the Armistice `remembrance` family, or the picker would collapse
    // it with Veterans Day.
    authoredAt: V1,
  },
  {
    slug: "us-fathers-day",
    name: "Father's Day",
    icon: "👔",
    greeting: "a Happy Father's Day",
    // Third Sunday in June.
    recurrence: { type: "nth-weekday", month: 6, weekday: 0, nth: 3 },
    tradition: "secular",
    region: "us",
    affiliations: KEPT_BY_WHOEVER_YOU_SAY,
    familyId: "fathers-day",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-labor-day",
    name: "Labor Day",
    icon: "🛠️",
    greeting: "a Happy Labor Day",
    // First Monday in September.
    recurrence: { type: "nth-weekday", month: 9, weekday: 1, nth: 1 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    suggestions: GATHERING,
    authoredAt: V1,
  },
  {
    slug: "us-columbus-day",
    name: "Columbus Day",
    icon: "⛵",
    greeting: "a Happy Columbus Day",
    // Second Monday in October. It shares a date with the next entry and no
    // `familyId`, so the picker takes no side between them.
    recurrence: { type: "nth-weekday", month: 10, weekday: 1, nth: 2 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    authoredAt: V3,
  },
  {
    slug: "us-indigenous-peoples-day",
    name: "Indigenous Peoples' Day",
    icon: "🪶",
    greeting: "a Happy Indigenous Peoples' Day",
    // Second Monday in October. See the note above.
    recurrence: { type: "nth-weekday", month: 10, weekday: 1, nth: 2 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    authoredAt: V3,
  },
  {
    slug: "ca-thanksgiving",
    // A display name must stand alone in a flat list or search.
    name: "Canadian Thanksgiving",
    icon: "🦃",
    greeting: "a Happy Thanksgiving",
    // Second Monday in October; shares `thanksgiving` with the US entry.
    recurrence: { type: "nth-weekday", month: 10, weekday: 1, nth: 2 },
    tradition: "secular",
    region: "ca",
    affiliations: countries("CA"),
    suggestions: [{ label: "🦃 Plan Thanksgiving dinner", offsetDays: 21 }],
    familyId: "thanksgiving",
    authoredAt: V3,
  },
  {
    slug: "uk-remembrance-sunday",
    name: "Remembrance Sunday",
    icon: "🌺",
    greeting: "a peaceful Remembrance Sunday",
    // Second Sunday in November, unlike the family's fixed 11 November.
    recurrence: { type: "nth-weekday", month: 11, weekday: 0, nth: 2 },
    tradition: "secular",
    region: "uk",
    affiliations: countries("GB"),
    familyId: "remembrance",
    authoredAt: V3,
  },
  {
    slug: "us-thanksgiving",
    name: "Thanksgiving",
    icon: "🦃",
    greeting: "a Happy Thanksgiving",
    // Fourth Thursday in November.
    recurrence: { type: "nth-weekday", month: 11, weekday: 4, nth: 4 },
    tradition: "secular",
    region: "us",
    affiliations: countries("US"),
    suggestions: [{ label: "🦃 Plan Thanksgiving dinner", offsetDays: 21 }],
    familyId: "thanksgiving",
    impliedByLocale: true,
    authoredAt: V1,
  },

  // ── Computed, and derived from a computed base ────────────────────────────
  {
    slug: "western-easter",
    name: "Easter",
    icon: "🐣",
    greeting: "a Happy Easter",
    recurrence: { type: "computed", algorithm: "western-easter" },
    tradition: "christian",
    region: "global",
    affiliations: religion("christian"),
    familyId: "easter",
    authoredAt: V1,
  },
  {
    slug: "western-good-friday",
    name: "Good Friday",
    icon: "✝️",
    greeting: "a blessed Good Friday",
    // A derivation edge, which the resolver keeps acyclic.
    recurrence: { type: "offset", from: "western-easter", days: -2 },
    tradition: "christian",
    region: "global",
    affiliations: religion("christian"),
    familyId: "easter",
    authoredAt: V1,
  },
  {
    slug: "uk-mothering-sunday",
    name: "Mothering Sunday",
    icon: "💐",
    greeting: "a Happy Mothering Sunday",
    // The fourth Sunday of Lent: `us-mothers-day`'s family, on another rule.
    recurrence: { type: "offset", from: "western-easter", days: -21 },
    tradition: "christian",
    region: "uk",
    affiliations: KEPT_BY_WHOEVER_YOU_SAY,
    familyId: "mothers-day",
    authoredAt: V3,
  },

  {
    slug: "orthodox-easter",
    name: "Orthodox Easter",
    icon: "🥚",
    greeting: "a Happy Easter",
    // Its own rule, not a Western variant: the two diverge by up to five weeks.
    recurrence: { type: "computed", algorithm: "orthodox-easter" },
    tradition: "christian",
    region: "global",
    affiliations: ORTHODOX_EASTER,
    familyId: "easter",
    authoredAt: V3,
  },
  {
    slug: "orthodox-good-friday",
    name: "Orthodox Good Friday",
    icon: "✝️",
    greeting: "a blessed Good Friday",
    recurrence: { type: "offset", from: "orthodox-easter", days: -2 },
    tradition: "christian",
    region: "global",
    affiliations: ORTHODOX_EASTER,
    familyId: "easter",
    authoredAt: V3,
  },

  // ── Lunisolar (precomputed) — see the warning above ───────────────────────
  {
    slug: "hanukkah",
    name: "Hanukkah",
    icon: "🕎",
    greeting: "a Happy Hanukkah",
    // 25 Kislev, the first day's daytime date.
    recurrence: {
      type: "table",
      dates: [
        "2026-12-05",
        "2027-12-25",
        "2028-12-13",
        "2029-12-02",
        "2030-12-21",
        "2031-12-10",
        "2032-11-28",
        "2033-12-17",
        "2034-12-07",
        "2035-12-26",
        "2036-12-14",
        "2037-12-03",
        "2038-12-22",
        "2039-12-12",
        "2040-11-30",
        "2041-12-18",
        "2042-12-08",
        "2043-12-27",
        "2044-12-15",
        "2045-12-04",
        "2046-12-24",
        "2047-12-13",
        "2048-11-30",
        "2049-12-20",
        "2050-12-10",
        "2051-11-29",
        "2052-12-16",
        "2053-12-06",
        "2054-12-26",
        "2055-12-15",
        "2056-12-03",
      ],
    },
    tradition: "jewish",
    region: "global",
    affiliations: religion("jewish"),
    suggestions: [{ label: "🕎 Buy Hanukkah candles", offsetDays: 7 }],
    wishByDefault: true,
    durationDays: 8,
    authoredAt: V2,
  },
  {
    slug: "rosh-hashanah",
    name: "Rosh Hashanah",
    icon: "🍎",
    // Article-less: “Wish @Grandma Shana Tova”.
    greeting: "Shana Tova",
    // 1 Tishrei, daytime.
    recurrence: {
      type: "table",
      dates: [
        "2026-09-12",
        "2027-10-02",
        "2028-09-21",
        "2029-09-10",
        "2030-09-28",
        "2031-09-18",
        "2032-09-06",
        "2033-09-24",
        "2034-09-14",
        "2035-10-04",
        "2036-09-22",
        "2037-09-10",
        "2038-09-30",
        "2039-09-19",
        "2040-09-08",
        "2041-09-26",
        "2042-09-15",
        "2043-10-05",
        "2044-09-22",
        "2045-09-12",
        "2046-10-01",
        "2047-09-21",
        "2048-09-08",
        "2049-09-27",
        "2050-09-17",
        "2051-09-07",
        "2052-09-24",
        "2053-09-13",
        "2054-10-03",
        "2055-09-23",
        "2056-09-11",
      ],
    },
    tradition: "jewish",
    region: "global",
    affiliations: religion("jewish"),
    wishByDefault: true,
    durationDays: 2,
    authoredAt: V3,
  },
  {
    slug: "yom-kippur",
    name: "Yom Kippur",
    icon: "🕍",
    // A fast, never “Happy”; “an easy fast” is the idiom.
    greeting: "an easy fast",
    // 10 Tishrei, daytime.
    recurrence: {
      type: "table",
      dates: [
        "2026-09-21",
        "2027-10-11",
        "2028-09-30",
        "2029-09-19",
        "2030-10-07",
        "2031-09-27",
        "2032-09-15",
        "2033-10-03",
        "2034-09-23",
        "2035-10-13",
        "2036-10-01",
        "2037-09-19",
        "2038-10-09",
        "2039-09-28",
        "2040-09-17",
        "2041-10-05",
        "2042-09-24",
        "2043-10-14",
        "2044-10-01",
        "2045-09-21",
        "2046-10-10",
        "2047-09-30",
        "2048-09-17",
        "2049-10-06",
        "2050-09-26",
        "2051-09-16",
        "2052-10-03",
        "2053-09-22",
        "2054-10-12",
        "2055-10-02",
        "2056-09-20",
      ],
    },
    tradition: "jewish",
    region: "global",
    affiliations: religion("jewish"),
    authoredAt: V3,
  },
  {
    slug: "sukkot",
    name: "Sukkot",
    icon: "🌿",
    greeting: "a Happy Sukkot",
    // 15 Tishrei, daytime.
    recurrence: {
      type: "table",
      dates: [
        "2026-09-26",
        "2027-10-16",
        "2028-10-05",
        "2029-09-24",
        "2030-10-12",
        "2031-10-02",
        "2032-09-20",
        "2033-10-08",
        "2034-09-28",
        "2035-10-18",
        "2036-10-06",
        "2037-09-24",
        "2038-10-14",
        "2039-10-03",
        "2040-09-22",
        "2041-10-10",
        "2042-09-29",
        "2043-10-19",
        "2044-10-06",
        "2045-09-26",
        "2046-10-15",
        "2047-10-05",
        "2048-09-22",
        "2049-10-11",
        "2050-10-01",
        "2051-09-21",
        "2052-10-08",
        "2053-09-27",
        "2054-10-17",
        "2055-10-07",
        "2056-09-25",
      ],
    },
    tradition: "jewish",
    region: "global",
    affiliations: religion("jewish"),
    durationDays: 7,
    authoredAt: V3,
  },
  {
    slug: "passover",
    name: "Passover",
    icon: "🍷",
    greeting: "a Happy Passover",
    // 15 Nisan, daytime; eight days in the diaspora, seven in Israel.
    recurrence: {
      type: "table",
      dates: [
        "2027-04-22",
        "2028-04-11",
        "2029-03-31",
        "2030-04-18",
        "2031-04-08",
        "2032-03-27",
        "2033-04-14",
        "2034-04-04",
        "2035-04-24",
        "2036-04-12",
        "2037-03-31",
        "2038-04-20",
        "2039-04-09",
        "2040-03-29",
        "2041-04-16",
        "2042-04-05",
        "2043-04-25",
        "2044-04-12",
        "2045-04-02",
        "2046-04-21",
        "2047-04-11",
        "2048-03-29",
        "2049-04-17",
        "2050-04-07",
        "2051-03-28",
        "2052-04-14",
        "2053-04-03",
        "2054-04-23",
        "2055-04-13",
        "2056-04-01",
      ],
    },
    tradition: "jewish",
    region: "global",
    affiliations: religion("jewish"),
    suggestions: [{ label: "🍷 Plan the Seder", offsetDays: 21 }],
    durationDays: 8,
    authoredAt: V3,
  },
  {
    slug: "lunar-new-year",
    name: "Lunar New Year",
    icon: "🧧",
    greeting: "a Happy Lunar New Year",
    // First day of Chinese month 1, from true new moons in UTC+8.
    recurrence: {
      type: "table",
      dates: [
        "2027-02-06",
        "2028-01-26",
        "2029-02-13",
        "2030-02-03",
        "2031-01-23",
        "2032-02-11",
        "2033-01-31",
        "2034-02-19",
        "2035-02-08",
        "2036-01-28",
        "2037-02-15",
        "2038-02-04",
        "2039-01-24",
        "2040-02-12",
        "2041-02-01",
        "2042-01-22",
        "2043-02-10",
        "2044-01-30",
        "2045-02-17",
        "2046-02-06",
        "2047-01-26",
        "2048-02-14",
        "2049-02-02",
        "2050-01-23",
        "2051-02-11",
        "2052-02-01",
        "2053-02-19",
        "2054-02-08",
        "2055-01-28",
        "2056-02-15",
      ],
    },
    tradition: "chinese",
    region: "global",
    affiliations: countries(
      "CN",
      "TW",
      "HK",
      "MO",
      "SG",
      "MY",
      "VN",
      "KR",
      "ID",
      "BN",
      "PH",
    ),
    suggestions: [{ label: "🥟 Plan a reunion dinner", offsetDays: 21 }],
    wishByDefault: true,
    familyId: "lunar-new-year",
    authoredAt: V2,
  },
  {
    slug: "lantern-festival",
    name: "Lantern Festival",
    icon: "🏮",
    greeting: "a Happy Lantern Festival",
    // Derived, not tabled, so it inherits Lunar New Year's horizon and fixes.
    recurrence: { type: "offset", from: "lunar-new-year", days: 14 },
    tradition: "chinese",
    region: "global",
    affiliations: CHINESE_FESTIVAL,
    authoredAt: V3,
  },
  {
    slug: "dragon-boat-festival",
    name: "Dragon Boat Festival",
    icon: "🐉",
    greeting: "a Happy Dragon Boat Festival",
    // 5th day of Chinese month 5.
    recurrence: {
      type: "table",
      dates: [
        "2026-06-19",
        "2027-06-09",
        "2028-05-28",
        "2029-06-16",
        "2030-06-05",
        "2031-06-24",
        "2032-06-12",
        "2033-06-01",
        "2034-06-20",
        "2035-06-10",
        "2036-05-30",
        "2037-06-18",
        "2038-06-07",
        "2039-05-27",
        "2040-06-14",
        "2041-06-03",
        "2042-06-22",
        "2043-06-11",
        "2044-05-31",
        "2045-06-19",
        "2046-06-08",
        "2047-05-29",
        "2048-06-15",
        "2049-06-04",
        "2050-06-23",
        "2051-06-13",
        "2052-06-01",
        "2053-06-20",
        "2054-06-10",
        "2055-05-30",
        "2056-06-17",
      ],
    },
    tradition: "chinese",
    region: "global",
    affiliations: countries("CN", "TW", "HK", "MO"),
    authoredAt: V3,
  },
  {
    slug: "mid-autumn-festival",
    name: "Mid-Autumn Festival",
    icon: "🥮",
    greeting: "a Happy Mid-Autumn Festival",
    // 15th day of Chinese month 8, the harvest full moon.
    recurrence: {
      type: "table",
      dates: [
        "2026-09-25",
        "2027-09-15",
        "2028-10-03",
        "2029-09-22",
        "2030-09-12",
        "2031-10-01",
        "2032-09-19",
        "2033-09-08",
        "2034-09-27",
        "2035-09-16",
        "2036-10-04",
        "2037-09-24",
        "2038-09-13",
        "2039-10-02",
        "2040-09-20",
        "2041-09-10",
        "2042-09-28",
        "2043-09-17",
        "2044-10-05",
        "2045-09-25",
        "2046-09-15",
        "2047-10-04",
        "2048-09-22",
        "2049-09-11",
        "2050-09-30",
        "2051-09-19",
        "2052-09-07",
        "2053-09-26",
        "2054-09-16",
        "2055-10-05",
        "2056-09-24",
      ],
    },
    tradition: "chinese",
    region: "global",
    affiliations: countries("CN", "TW", "HK", "MO", "SG", "MY", "VN"),
    authoredAt: V3,
  },
];

/** Every entry, by slug — built once. */
const BY_SLUG = new Map(CATALOG.map((e) => [e.slug, e]));

/** An entry's grouping facts, as the browse list consumes them. */
export interface HolidayClassification {
  tradition: HolidayTradition;
  region: HolidayRegion;
  /** The key the browse list sections on: region if secular, else tradition. */
  groupKey: HolidayTradition | HolidayRegion;
}

/** A slug's classification, or `null` for one this bundle lacks, which
 *  callers group under “Other”. */
export function classificationFor(slug: string): HolidayClassification | null {
  const entry = BY_SLUG.get(slug);
  if (entry === undefined) return null;
  return {
    tradition: entry.tradition,
    region: entry.region,
    groupKey: entry.tradition === "secular" ? entry.region : entry.tradition,
  };
}

/** Who keeps a slug's holiday, or `null` for one this bundle lacks or a
 *  user-defined one, which only explicit observers keep. */
export function affiliationsFor(slug: string): HolidayAffiliations | null {
  return BY_SLUG.get(slug)?.affiliations ?? null;
}

/** Whether a slug's holiday is wished to every observer by default. */
export function wishByDefaultFor(slug: string): boolean {
  return BY_SLUG.get(slug)?.wishByDefault === true;
}

/** The errands of your own a slug's prompt offers, or none. */
/** A catalog holiday's emoji; a holiday of the user's own has none. */
export function iconFor(slug: string): string | undefined {
  return BY_SLUG.get(slug)?.icon;
}

export function suggestionsFor(slug: string): readonly HolidaySuggestion[] {
  return BY_SLUG.get(slug)?.suggestions ?? [];
}
