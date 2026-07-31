/**
 * The one interface every caller asks a holiday's dates through:
 * `occurrencesFor(slug, year)` (`@leapsake/holidays` README, recurrence). Callers never
 * learn whether an arithmetic rule or a precomputed table answered — which is
 * the point, and what lets the lunisolar tables be replaced by a real calendar
 * implementation later with no caller change.
 *
 * The resolver is constructed over a *set* of entries because `offset` rules
 * make the catalog a directed graph (Good Friday ← Easter). It owns three things
 * a single-entry function could not: memoization across the graph, a depth cap,
 * and cycle detection.
 *
 * ## Why it degrades instead of throwing
 *
 * The same resolver runs over the **bundled** catalog, where a cycle is an
 * authoring bug that should fail loudly in CI, and over **synced rows**, where
 * anything can arrive: a holiday whose base hasn't been pulled yet (`pull`
 * applies records one at a time across paginated batches with no cross-table
 * transaction), a rule shape written by a newer build, a cycle assembled from
 * two independently-valid edits on two devices. In production it must always
 * answer, so an unresolvable entry yields `[]` — research §3's "keep the row,
 * generate nothing". `strict: true` flips the authoring bugs back into throws,
 * and is used by the catalog's unit test, never at runtime on a user's device.
 */

import { type CivilDate, daysUntil } from "@leapsake/schema";
import {
  type HolidayRecurrence,
  isoFromCivil,
  occurrencesInYear,
  shiftDays,
} from "./recurrence.js";

/**
 * An entry the resolver can answer for: a slug and its rule, already parsed. A
 * `null` rule (a row this build can't understand) is legal and yields no
 * occurrences.
 */
export interface ResolvableHoliday {
  slug: string;
  recurrence: HolidayRecurrence | null;
}

export interface HolidayResolverOptions {
  /**
   * Throw on a cycle or an unknown `offset` base instead of yielding `[]`. For
   * the bundled-catalog test only — never for synced rows, where a missing base
   * is an ordinary interleaving of sync batches rather than a bug.
   */
  strict?: boolean;
}

export interface HolidayResolver {
  /** Every civil day this holiday lands on in `year`; `[]` if it doesn't occur. */
  occurrencesFor(slug: string, year: number): readonly CivilDate[];
  /**
   * Occurrences from `today` (inclusive) through `horizonDays` later, ascending.
   * Spans the year boundary, so a December call still sees January.
   */
  upcomingOccurrences(
    slug: string,
    today: CivilDate,
    horizonDays: number,
  ): readonly CivilDate[];
}

/**
 * The longest `offset` chain that will be followed. Real derivation chains are
 * one hop (Good Friday from Easter); four is generous. It bounds the work a
 * hostile or corrupted row can cause even before cycle detection catches it.
 */
const MAX_DERIVATION_DEPTH = 4;

export function createHolidayResolver(
  entries: readonly ResolvableHoliday[],
  options: HolidayResolverOptions = {},
): HolidayResolver {
  const strict = options.strict ?? false;
  const bySlug = new Map<string, ResolvableHoliday>();
  for (const entry of entries) bySlug.set(entry.slug, entry);

  const cache = new Map<string, readonly CivilDate[]>();
  // Slugs currently being resolved, deepest last — the cycle detector. Keyed by
  // slug rather than (slug, year) because an offset rule widens its search a
  // year either side, so a cycle shows up across years, not within one.
  const inProgress = new Set<string>();

  function resolve(slug: string, year: number, depth: number): CivilDate[] {
    const entry = bySlug.get(slug);
    if (entry === undefined) {
      if (strict) throw new Error(`holiday resolver: unknown slug "${slug}"`);
      return [];
    }
    if (depth > MAX_DERIVATION_DEPTH) {
      if (strict) {
        throw new Error(`holiday resolver: derivation too deep at "${slug}"`);
      }
      return [];
    }
    if (inProgress.has(slug)) {
      if (strict) {
        throw new Error(`holiday resolver: derivation cycle at "${slug}"`);
      }
      return [];
    }

    const key = `${slug}:${year}`;
    const hit = cache.get(key);
    if (hit !== undefined) return [...hit];

    inProgress.add(slug);
    try {
      const dates = occurrencesInYear(entry.recurrence, year, (from, y) =>
        resolve(from, y, depth + 1),
      );
      cache.set(key, dates);
      return [...dates];
    } finally {
      inProgress.delete(slug);
    }
  }

  return {
    occurrencesFor: (slug, year) => resolve(slug, year, 0),

    upcomingOccurrences(slug, today, horizonDays) {
      // Search every year the horizon actually touches, not a fixed two. A
      // hardcoded range silently truncates the moment the horizon exceeds a
      // year — the caller gets a short list that looks perfectly plausible.
      // Starting at `today.year` is enough at the near end: an `offset` rule
      // already widens its own search a year either side, so a date pulled back
      // from January is found when its own year is resolved.
      const lastYear = shiftDays(today, Math.max(horizonDays, 0)).year;
      const candidates: CivilDate[] = [];
      for (let year = today.year; year <= lastYear; year++) {
        candidates.push(...resolve(slug, year, 0));
      }
      const seen = new Set<string>();
      const out: CivilDate[] = [];
      for (const date of candidates) {
        const days = daysUntil(today, date);
        if (days < 0 || days > horizonDays) continue;
        const iso = isoFromCivil(date);
        if (seen.has(iso)) continue; // the two years can overlap at the seam
        seen.add(iso);
        out.push(date);
      }
      // Ascending: `daysUntil(b, a)` is negative when `a` is the earlier date,
      // which is the order `sort` wants. (`daysUntil(a, b)` reads the right way
      // round in English and sorts exactly backwards.)
      return out.sort((a, b) => daysUntil(b, a));
    },
  };
}
