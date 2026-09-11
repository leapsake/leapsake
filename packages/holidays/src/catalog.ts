/**
 * The bundled holiday catalog — the public reference data that ships with the
 * app and works with no network, ever (`@leapsake/holidays` README, OTA:
 * "bundled-first remains the floor").
 *
 * Authored as a TypeScript module rather than JSON so a typo in a recurrence
 * discriminant is a compile error instead of a runtime seed failure, and so the
 * authored timestamps are reviewed as literals in a diff.
 *
 * ## How this becomes rows
 *
 * `@leapsake/core` seeds these into the synced `holidays` table, gated on
 * {@link CATALOG_VERSION} against a device-local mark (research §3: seed by
 * stored version, never by inspecting whether rows exist — the latter re-seeds a
 * device that received the catalog via sync and resurrects deleted rows). Each
 * row's `updatedAt` is the entry's own {@link HolidayEntry.authoredAt}, which is
 * what makes ordinary whole-row LWW correct by construction (research §2.5):
 * every device seeding the same release writes byte-identical rows, and a device
 * that seeds an older release after receiving a newer one simply loses.
 *
 * ## Editing this file
 *
 * - **`authoredAt` is per entry, not per release.** Bump it only on the entries
 *   that actually changed; everything else stays byte-identical and merges as a
 *   no-op. A shared release stamp would push the entire catalog on every update.
 * - **Bump {@link CATALOG_VERSION}** whenever any entry changes, or no device
 *   will re-seed. It is an integer, not semver — the `sync_state` value column
 *   it is compared against holds integers.
 * - **Never delete an entry.** Absence cannot communicate removal to a device
 *   that already seeded it (research §3); set `retiredAt` instead and it seeds
 *   as a tombstone.
 * - **Slugs are fully qualified from day one** (research §2.7): `us-thanksgiving`
 *   and `western-easter`, not `thanksgiving` and `easter`, *while the US is the
 *   only country here*. Expansion is then pure addition rather than a rename,
 *   and no `supersededBy` mechanism is needed.
 */

import type { HolidayRecurrence } from "./recurrence.js";

/**
 * A single catalog entry, before it becomes a `holidays` row. The recurrence is
 * a live object here and is serialized to its canonical string on the way in.
 */
export interface HolidayEntry {
  /** Stable, human-readable identity; the row's UUID is derived from it. */
  slug: string;
  name: string;
  /**
   * The occasion phrase reminder copy interpolates: "Wish @Violet **a Merry
   * Christmas**". Carries its own article, because not every greeting takes one
   * ("Eid Mubarak"). This is what retires the birthday-specific copy baked into
   * `actionDefs.wish` (research §2.14).
   */
  greeting: string;
  recurrence: HolidayRecurrence;
  /**
   * Length in days for a multi-day holiday, for display only. The occurrence
   * always anchors to the **start** date; "remind during" is a different feature
   * (research §3).
   */
  durationDays?: number;
  /**
   * Groups entries that are the same idea with different rules —
   * `us-mothers-day` and `uk-mothering-sunday`. Display and picker dedup only;
   * it is not a computation dependency (research §2.13).
   */
  familyId?: string;
  /**
   * Whether it is safe to infer this holiday from the *user's own* locale
   * without asserting anything about a third party's religion (research §2.12).
   * Unused in v1 — no implicit source exists yet — but authored now so the
   * accelerator layer is purely additive.
   */
  impliedByLocale?: boolean;
  /** The catalog release's authored time, epoch ms. See the module doc. */
  authoredAt: number;
  /** Set instead of deleting; seeds as a tombstone. */
  retiredAt?: number;
}

/** Readable spelling of an authored date: `authored("2026-07-20")`. */
function authored(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

const V1 = authored("2026-07-20");
const V2 = authored("2026-07-23");

/**
 * Bump on any change to {@link CATALOG}. Integer, not semver — see the module
 * doc.
 */
export const CATALOG_VERSION = 2;

/**
 * ## The lunisolar tables
 *
 * The two `table` entries below (Hanukkah, Lunar New Year) run to **2056**, the
 * ~30-year horizon research §2.8 asks for. Past it they stop producing
 * occurrences rather than producing wrong ones — the honest degradation the
 * `table` shape exists for. **Extend them before ~2050**, and re-derive rather
 * than extrapolate: neither sequence has a period that can be continued by eye.
 *
 * They are here rather than deferred because research §2.9 is explicit that the
 * precomputed path must be proven end-to-end early — a user cannot hand-author
 * these holidays themselves, so the catalog is the only place they can come
 * from, and the recurrence engine must not ossify around arithmetic rules.
 *
 * ### How these dates were derived
 *
 * Both were computed from the source calendars' own rules and then cross-checked
 * against a second, independent implementation (ICU's `Intl` calendar data, via
 * `en-u-ca-hebrew` and `en-u-ca-chinese`), plus a regression against known
 * published dates for years already past. A wrong date here is worse than a
 * missing one — it produces a confidently-wrong reminder on a day that matters
 * to someone — so no date rests on a single source.
 *
 * - **Hanukkah** is 25 Kislev. The Hebrew calendar is *purely arithmetic* (molad
 *   plus the four dehiyyot), so these dates are **exact**, with no observational
 *   or borderline cases. The independent computation and ICU agree on all 41
 *   years checked, and reproduce 2023–2026 as published.
 * - **Lunar New Year** is the first day of the first Chinese month, which
 *   depends on true astronomical new moons evaluated in **China Standard Time
 *   (UTC+8)**: month 11 is the month containing the December solstice, a leap
 *   month is inserted where a month contains no major solar term, and month 1
 *   follows two months later — three, when a leap month intervenes. Computed
 *   with Meeus' new-moon and solar-longitude series; reproduces 2020–2026 as
 *   published, **including 2034**, where the naive "second new moon after the
 *   solstice" shortcut gives 2034-01-20 and the leap-month rule correctly gives
 *   2034-02-19 (the well-known 2033 anomaly).
 *
 * Two Lunar New Year dates are astronomically **borderline** — the new moon
 * falls within minutes of local midnight, so the civil date turns on precision
 * rather than on the rule: **2027** (23:56 CST, 4 min before midnight) and
 * **2030** (00:07 CST, 7 min after). ICU disagrees on exactly these two and no
 * others, which is the signature of its lower-precision astronomer rather than a
 * dispute about the calendar. The values kept here match the Meeus computation
 * and the published tables. If either is ever contradicted by the Purple
 * Mountain Observatory's official almanac, that is the authority — change it.
 */
export const CATALOG: readonly HolidayEntry[] = [
  // ── Fixed date ────────────────────────────────────────────────────────────
  {
    slug: "new-years-day",
    name: "New Year's Day",
    greeting: "a Happy New Year",
    recurrence: { type: "fixed", month: 1, day: 1 },
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-valentines",
    name: "Valentine's Day",
    greeting: "a Happy Valentine's Day",
    recurrence: { type: "fixed", month: 2, day: 14 },
    familyId: "valentines",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-juneteenth",
    name: "Juneteenth",
    greeting: "a Happy Juneteenth",
    recurrence: { type: "fixed", month: 6, day: 19 },
    authoredAt: V1,
  },
  {
    slug: "us-independence-day",
    name: "Independence Day",
    greeting: "a Happy Fourth of July",
    recurrence: { type: "fixed", month: 7, day: 4 },
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-halloween",
    name: "Halloween",
    greeting: "a Happy Halloween",
    recurrence: { type: "fixed", month: 10, day: 31 },
    familyId: "halloween",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "christmas",
    name: "Christmas",
    greeting: "a Merry Christmas",
    recurrence: { type: "fixed", month: 12, day: 25 },
    familyId: "christmas",
    // Christmas-as-secular-gift-occasion is safe to imply from a US locale
    // (research §2.12) — it asserts an occasion, not a religion.
    impliedByLocale: true,
    authoredAt: V1,
  },

  // ── Nth weekday of month ──────────────────────────────────────────────────
  {
    slug: "us-mothers-day",
    name: "Mother's Day",
    greeting: "a Happy Mother's Day",
    // Second Sunday in May.
    recurrence: { type: "nth-weekday", month: 5, weekday: 0, nth: 2 },
    familyId: "mothers-day",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-memorial-day",
    name: "Memorial Day",
    greeting: "a peaceful Memorial Day",
    // Last Monday in May — the shape `nth: -1` exists for.
    recurrence: { type: "nth-weekday", month: 5, weekday: 1, nth: -1 },
    authoredAt: V1,
  },
  {
    slug: "us-fathers-day",
    name: "Father's Day",
    greeting: "a Happy Father's Day",
    // Third Sunday in June.
    recurrence: { type: "nth-weekday", month: 6, weekday: 0, nth: 3 },
    familyId: "fathers-day",
    impliedByLocale: true,
    authoredAt: V1,
  },
  {
    slug: "us-labor-day",
    name: "Labor Day",
    greeting: "a Happy Labor Day",
    // First Monday in September.
    recurrence: { type: "nth-weekday", month: 9, weekday: 1, nth: 1 },
    authoredAt: V1,
  },
  {
    slug: "us-thanksgiving",
    name: "Thanksgiving",
    greeting: "a Happy Thanksgiving",
    // Fourth Thursday in November.
    recurrence: { type: "nth-weekday", month: 11, weekday: 4, nth: 4 },
    familyId: "thanksgiving",
    impliedByLocale: true,
    authoredAt: V1,
  },

  // ── Computed, and derived from a computed base ────────────────────────────
  {
    slug: "western-easter",
    name: "Easter",
    greeting: "a Happy Easter",
    recurrence: { type: "computed", algorithm: "western-easter" },
    familyId: "easter",
    authoredAt: V1,
  },
  {
    slug: "western-good-friday",
    name: "Good Friday",
    greeting: "a blessed Good Friday",
    // The only derivation edge in the v1 catalog; directed and acyclic, which
    // the resolver enforces at construction (research §2.13).
    recurrence: { type: "offset", from: "western-easter", days: -2 },
    familyId: "easter",
    authoredAt: V1,
  },

  // ── Lunisolar (precomputed) — see the warning above ───────────────────────
  {
    slug: "hanukkah",
    name: "Hanukkah",
    greeting: "a Happy Hanukkah",
    // 25 Kislev — the first day (the daytime date; the festival begins the
    // preceding evening). Exact: the Hebrew calendar is arithmetic. See the
    // module doc for derivation.
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
    durationDays: 8,
    authoredAt: V2,
  },
  {
    slug: "lunar-new-year",
    name: "Lunar New Year",
    greeting: "a Happy Lunar New Year",
    // First day of Chinese month 1, from true new moons in UTC+8. 2027 and 2030
    // are the borderline pair called out in the module doc.
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
    familyId: "lunar-new-year",
    authoredAt: V2,
  },
];
