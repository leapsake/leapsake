import {
  type HolidayResolver,
  createHolidayResolver,
  isoFromCivil,
  parseRecurrence,
} from "@leapsake/holidays";
import type {
  HiddenHolidaysRepo,
  HolidaysRepo,
  ObservancesRepo,
} from "@leapsake/data";
import {
  type CivilDate,
  type HolidayOrigin,
  todayCivil,
} from "@leapsake/schema";

/**
 * The read side of Holidays: the catalog as the browse screen sees it, with each
 * entry's rule already resolved to a real upcoming date.
 *
 * The resolver is built **over the rows**, not over the bundled catalog module,
 * so user-defined and synced-from-another-device holidays resolve through
 * exactly the same path as shipped ones — and so a holiday whose rule this build
 * doesn't understand simply reports no upcoming date instead of breaking the
 * screen.
 */

/**
 * How far ahead "next occurrence" looks. Two years, so a holiday late in the
 * calendar still shows its next date when viewed in December, and a table-backed
 * holiday that has run past its horizon honestly reports nothing rather than
 * inventing a date.
 */
const LOOKAHEAD_DAYS = 730;

export interface HolidayListItem {
  id: string;
  slug: string;
  name: string;
  greeting: string;
  durationDays: number | null;
  familyId: string | null;
  origin: HolidayOrigin;
  /**
   * The next occurrence as `YYYY-MM-DD`, or `null` when there isn't one within
   * the lookahead — an unparseable rule, a missing derivation base, or a
   * precomputed table that has run out. Never a guess.
   */
  nextOccurrence: string | null;
  /** Whether the user has suppressed this holiday entirely. */
  hidden: boolean;
  /** How many people/pets explicitly observe it. */
  observerCount: number;
}

export interface HolidayDetail extends HolidayListItem {
  /** The next few occurrences, ascending — context for the detail screen. */
  upcoming: string[];
}

export interface HolidaysApiDeps {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  /** The viewer's local civil date; injectable so tests aren't clock-dependent. */
  today?: () => CivilDate;
}

/**
 * Read the whole catalog once and return a resolver over it plus the lookups the
 * list and detail views both need.
 *
 * Deliberately one read of each table rather than a per-holiday query: the
 * candidate set here is (holidays × people), which is exactly the shape research
 * §3 warns about, so counting observers from a single in-memory grouping keeps
 * the browse screen at three queries no matter how large the catalog grows.
 */
async function loadCatalog(deps: HolidaysApiDeps): Promise<{
  rows: Awaited<ReturnType<HolidaysRepo["list"]>>;
  resolver: HolidayResolver;
  hidden: Set<string>;
  observerCounts: Map<string, number>;
}> {
  const [rows, hidden, observances] = await Promise.all([
    deps.holidays.list(),
    deps.hiddenHolidays.listHiddenIds(),
    deps.observances.list(),
  ]);

  const resolver = createHolidayResolver(
    rows.map((row) => ({
      slug: row.slug,
      recurrence: parseRecurrence(row.recurrence),
    })),
  );

  const observerCounts = new Map<string, number>();
  for (const row of observances) {
    // An explicit `false` is an override — the bearer does *not* observe — so it
    // must not be counted as an observer.
    if (!row.observes) continue;
    observerCounts.set(
      row.holidayId,
      (observerCounts.get(row.holidayId) ?? 0) + 1,
    );
  }

  return { rows, resolver, hidden, observerCounts };
}

export function createHolidaysApi(deps: HolidaysApiDeps) {
  const now = deps.today ?? todayCivil;

  return {
    /**
     * Every holiday in the catalog, soonest-occurring first, with hidden ones
     * last. Hidden entries are still listed — the browse screen is where a user
     * goes to *unhide* one, so filtering them out would strand them.
     */
    async list(): Promise<HolidayListItem[]> {
      const { rows, resolver, hidden, observerCounts } =
        await loadCatalog(deps);
      const today = now();

      const items = rows.map((row) => {
        const [next] = resolver.upcomingOccurrences(
          row.slug,
          today,
          LOOKAHEAD_DAYS,
        );
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          greeting: row.greeting,
          durationDays: row.durationDays,
          familyId: row.familyId,
          origin: row.origin,
          nextOccurrence: next === undefined ? null : isoFromCivil(next),
          hidden: hidden.has(row.id),
          observerCount: observerCounts.get(row.id) ?? 0,
        };
      });

      return items.sort(compareForBrowse);
    },

    /** One holiday with its next few dates, or undefined if it doesn't exist. */
    async get(id: string): Promise<HolidayDetail | undefined> {
      const { rows, resolver, hidden, observerCounts } =
        await loadCatalog(deps);
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return undefined;

      const upcoming = resolver.upcomingOccurrences(
        row.slug,
        now(),
        LOOKAHEAD_DAYS,
      );
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        greeting: row.greeting,
        durationDays: row.durationDays,
        familyId: row.familyId,
        origin: row.origin,
        nextOccurrence:
          upcoming[0] === undefined ? null : isoFromCivil(upcoming[0]),
        hidden: hidden.has(row.id),
        observerCount: observerCounts.get(row.id) ?? 0,
        upcoming: upcoming.map(isoFromCivil),
      };
    },
  };
}

/**
 * Browse order: soonest first, then holidays with no upcoming date, then hidden
 * ones — with name as the stable tiebreak. Undated entries sink rather than
 * disappear so an unresolvable holiday is visible enough to be diagnosed.
 */
function compareForBrowse(a: HolidayListItem, b: HolidayListItem): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
  if (a.nextOccurrence !== b.nextOccurrence) {
    if (a.nextOccurrence === null) return 1;
    if (b.nextOccurrence === null) return -1;
    return a.nextOccurrence < b.nextOccurrence ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
