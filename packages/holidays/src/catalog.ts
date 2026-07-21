/**
 * The bundled holiday catalog — the public reference data that ships with the
 * app and works with no network, ever (plans/holidays/research.md §2.10:
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
   * The occasion phrase reminder copy interpolates: "Wish @Alice **a Merry
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

/**
 * Bump on any change to {@link CATALOG}. Integer, not semver — see the module
 * doc.
 */
export const CATALOG_VERSION = 1;

/**
 * ⚠️ **The two lunisolar tables below are provisional and must be verified
 * against an authoritative source before this ships.** They were authored from
 * memory, and a wrong date here is worse than a missing one: it produces a
 * confidently-wrong reminder on a day that matters to someone. The mechanism
 * they exercise is correct and tested; the *data* needs sourcing (Hebcal for
 * Hanukkah, the Hong Kong Observatory or a published Chinese calendar for Lunar
 * New Year), and the horizon should be extended to ~30 years at the same time.
 *
 * They are included now rather than deferred because research §2.9 is explicit
 * that the precomputed path must be proven end-to-end early — a user cannot
 * hand-author these holidays themselves, so the catalog is the only place they
 * can come from, and the recurrence engine must not ossify around arithmetic
 * rules.
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
    // First day (the daytime date; the festival begins the preceding evening).
    // PROVISIONAL — verify against Hebcal and extend to a ~30-year horizon.
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
      ],
    },
    durationDays: 8,
    authoredAt: V1,
  },
  {
    slug: "lunar-new-year",
    name: "Lunar New Year",
    greeting: "a Happy Lunar New Year",
    // PROVISIONAL — verify against a published Chinese calendar and extend to a
    // ~30-year horizon.
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
      ],
    },
    familyId: "lunar-new-year",
    authoredAt: V1,
  },
];
