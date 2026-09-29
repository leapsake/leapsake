// Resolves a set of entries, since `offset` rules make a graph: memoized, depth
// capped, cycle-checked. An unresolvable entry yields `[]` unless `strict`.

import { type CivilDate, daysUntil } from "@leapsake/schema";
import {
  type HolidayRecurrence,
  isoFromCivil,
  occurrencesInYear,
  shiftDays,
} from "./recurrence.js";

/** A slug and its parsed rule; a `null` rule yields no occurrences. */
export interface ResolvableHoliday {
  slug: string;
  recurrence: HolidayRecurrence | null;
}

export interface HolidayResolverOptions {
  /** Throws on a cycle or unknown base rather than yielding `[]`; for the
   *  bundled-catalog test, never for synced rows. */
  strict?: boolean;
}

export interface HolidayResolver {
  /** Every civil day this holiday lands on in `year`, or `[]`. */
  occurrencesFor(slug: string, year: number): readonly CivilDate[];
  /** Occurrences from `lookbackDays` before `today` to `horizonDays` after,
   *  ascending, across year boundaries. */
  upcomingOccurrences(
    slug: string,
    today: CivilDate,
    horizonDays: number,
    lookbackDays?: number,
  ): readonly CivilDate[];
}

/** The longest `offset` chain followed, bounding a corrupted row's cost. */
const MAX_DERIVATION_DEPTH = 4;

export function createHolidayResolver(
  entries: readonly ResolvableHoliday[],
  options: HolidayResolverOptions = {},
): HolidayResolver {
  const strict = options.strict ?? false;
  const bySlug = new Map<string, ResolvableHoliday>();
  for (const entry of entries) bySlug.set(entry.slug, entry);

  const cache = new Map<string, readonly CivilDate[]>();
  // The cycle detector, keyed by slug: an offset rule searches a year either
  // side, so a cycle crosses years.
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

    upcomingOccurrences(slug, today, horizonDays, lookbackDays = 0) {
      // Every year the window touches, back through the lookback, or a long
      // horizon or a Jan-1 lookback silently loses dates.
      const lookback = Math.max(lookbackDays, 0);
      const firstYear = shiftDays(today, -lookback).year;
      const lastYear = shiftDays(today, Math.max(horizonDays, 0)).year;
      const candidates: CivilDate[] = [];
      for (let year = firstYear; year <= lastYear; year++) {
        candidates.push(...resolve(slug, year, 0));
      }
      const seen = new Set<string>();
      const out: CivilDate[] = [];
      for (const date of candidates) {
        const days = daysUntil(today, date);
        if (days < -lookback || days > horizonDays) continue;
        const iso = isoFromCivil(date);
        if (seen.has(iso)) continue; // the two years can overlap at the seam
        seen.add(iso);
        out.push(date);
      }
      // Ascending; `daysUntil(a, b)` would sort backwards.
      return out.sort((a, b) => daysUntil(b, a));
    },
  };
}
