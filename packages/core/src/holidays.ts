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
  PeopleRepo,
  PetsRepo,
  SqliteDriver,
} from "@leapsake/data";
import {
  type CivilDate,
  type HolidayOrigin,
  type ObservanceBearerType,
  fullName,
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

export interface HolidayObserverCandidate {
  bearerType: ObservanceBearerType;
  bearerId: string;
  label: string;
  /**
   * The **stored** answer: `true`/`false` when the user has said so explicitly,
   * `null` when there is no row and the bearer rides the implicit answer.
   * Distinct from {@link observes} on purpose — the picker needs to know whether
   * clearing a box means "write an override" or "delete the row".
   */
  explicit: boolean | null;
  /** The effective answer: what the reminder engine would act on. */
  observes: boolean;
}

/** One row of a picker save. */
export interface ObserverDecision {
  bearerType: ObservanceBearerType;
  bearerId: string;
  observes: boolean;
}

export interface HolidaysApiDeps {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  people: PeopleRepo;
  pets: PetsRepo;
  /** Composes a whole picker save into one transaction. */
  driver: SqliteDriver;
  /** The viewer's local civil date; injectable so tests aren't clock-dependent. */
  today?: () => CivilDate;
}

/** The key an observance is addressed by within one holiday. */
function bearerKey(bearerType: ObservanceBearerType, bearerId: string): string {
  return `${bearerType}:${bearerId}`;
}

/**
 * The bearers who observe a holiday **implicitly** — inferred rather than
 * stated.
 *
 * v1 returns nothing, uniformly and unconditionally, and that is a deliberate
 * shape rather than a stub. No reliable implicit source exists yet: religion
 * isn't recorded anywhere, and country lives on *contact methods* rather than on
 * the person (research §2.12). Returning an empty set unconditionally — instead
 * of making the resolver conditional on a feature that doesn't exist — means the
 * accelerator layer (Religions, Nationalities, a Settings default country) is
 * purely additive when it arrives.
 *
 * Two constraints bind whatever fills this in: never infer religion from
 * country or country from religion, and keep derived-nationality feeding
 * derived-observance a **single flattening pass**, so the UI can always answer
 * "why does Leapsake think Grandma observes this?".
 */
function implicitObservers(_holidayId: string): ReadonlySet<string> {
  return new Set<string>();
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

    /**
     * Every person and pet as a picker row, with their current answer for this
     * holiday — the "Christmas — who do you celebrate with?" read.
     *
     * Returns the *whole* address book rather than only current observers,
     * because the picker's job is bulk assignment: with no implicit source,
     * every observance starts explicit, and a screen that only listed existing
     * observers would have no way to add the first one.
     */
    async listObservers(
      holidayId: string,
    ): Promise<HolidayObserverCandidate[]> {
      const [people, pets, stored] = await Promise.all([
        deps.people.list(),
        deps.pets.list(),
        deps.observances.listForHoliday(holidayId),
      ]);

      const explicitByKey = new Map(
        stored.map((row) => [
          bearerKey(row.bearerType, row.bearerId),
          row.observes,
        ]),
      );
      const implicit = implicitObservers(holidayId);

      const candidates: HolidayObserverCandidate[] = [
        ...people.map((person) => ({
          bearerType: "person" as const,
          bearerId: person.id,
          label: fullName(person),
        })),
        ...pets.map((pet) => ({
          bearerType: "pet" as const,
          bearerId: pet.id,
          label: pet.name,
        })),
      ].map((base) => {
        const key = bearerKey(base.bearerType, base.bearerId);
        const explicit = explicitByKey.get(key) ?? null;
        return {
          ...base,
          explicit,
          // An explicit answer always wins over the implicit one — that is the
          // whole point of storing it.
          observes: explicit ?? implicit.has(key),
        };
      });

      return candidates.sort((a, b) => a.label.localeCompare(b.label));
    },

    /**
     * Save a picker's decisions, writing a row **only where the answer diverges
     * from the implicit one** (research §2.2).
     *
     * That asymmetry is the whole design, not an optimisation. A decision that
     * agrees with the implicit answer *deletes* its row rather than storing a
     * redundant one, which keeps untouched data free of sync churn and — more
     * importantly — keeps "the user said so" distinguishable from "the inference
     * happened to agree once". If the user later corrects the data an inference
     * was drawn from, the explicit row survives and the observance holds.
     *
     * The whole save is one transaction, so a partial failure can't leave the
     * holiday half-assigned.
     */
    async setObservers(
      holidayId: string,
      decisions: readonly ObserverDecision[],
    ): Promise<void> {
      const implicit = implicitObservers(holidayId);
      await deps.driver.transaction(async () => {
        for (const decision of decisions) {
          const key = bearerKey(decision.bearerType, decision.bearerId);
          const agreesWithImplicit = decision.observes === implicit.has(key);
          await deps.observances.setObservance(
            holidayId,
            decision.bearerType,
            decision.bearerId,
            agreesWithImplicit ? null : decision.observes,
          );
        }
      });
    },

    /**
     * Suppress or restore a holiday.
     *
     * Non-destructive in both directions: hiding never touches the observances
     * hanging off the holiday, so unhiding restores them intact. The one thing
     * it does *not* restore is the current occurrence's already-generated
     * reminders — hiding prunes those, and a pruned system reminder is
     * tombstoned rather than deleted, so it stays dead until the next
     * occurrence. Documented rather than fixed: telling "pruned because
     * suppressed" apart from "pruned because stale" is a distinction the engine
     * structurally does not have.
     */
    setHidden(holidayId: string, hidden: boolean): Promise<void> {
      return deps.hiddenHolidays.setHidden(holidayId, hidden);
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
