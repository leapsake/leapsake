import { type PersonAffiliations, isAffiliated } from "./affiliation.js";
import { affiliationsFor, wishByDefaultFor } from "./catalog.js";
import { isoFromCivil, parseRecurrence } from "./recurrence.js";
import { type HolidayResolver, createHolidayResolver } from "./resolver.js";
import { observanceIdFor } from "@leapsake/data";
import type {
  HiddenHolidaysRepo,
  HolidaysRepo,
  ObservancesRepo,
  PeopleRepo,
  PetsRepo,
  ReminderRulesRepo,
  SqliteDriver,
} from "@leapsake/data";
import {
  type HolidayOccurrenceCandidate,
  BELATED_DAYS,
} from "@leapsake/reminders";
import {
  type CivilDate,
  type Holiday,
  type HolidayOrigin,
  type ObservanceBearerType,
  type ReminderRuleInput,
  MAX_ACTIVE_DAYS,
  fullName,
  observanceDefaultReminderSchedule,
  resolveObservanceReminderSchedule,
  todayCivil,
} from "@leapsake/schema";

// The Holidays API, with a resolver built over the rows, so user-defined and
// synced holidays resolve exactly as shipped ones do.

/** How far ahead “next occurrence” looks: two years, so December sees one. */
const LOOKAHEAD_DAYS = 730;

export interface HolidayListItem {
  id: string;
  slug: string;
  name: string;
  greeting: string;
  durationDays: number | null;
  familyId: string | null;
  origin: HolidayOrigin;
  /** The next occurrence as `YYYY-MM-DD`, or `null` if none can be known. */
  nextOccurrence: string | null;
  /** Whether the user has suppressed this holiday entirely. */
  hidden: boolean;
  /** How many people and pets observe it, implicitly or explicitly. */
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
  /** The stored answer, or `null` with no row; tells the picker whether a
   *  change writes an override or deletes the row. */
  explicit: boolean | null;
  /** The effective answer: what the reminder engine would act on. */
  observes: boolean;
}

/** One holiday with one bearer's answer; no `observerCount`, which would scan
 *  every observance. */
export interface BearerHolidayCandidate {
  id: string;
  slug: string;
  name: string;
  greeting: string;
  durationDays: number | null;
  familyId: string | null;
  origin: HolidayOrigin;
  /** The next occurrence as `YYYY-MM-DD`, or `null`, as the browse list. */
  nextOccurrence: string | null;
  /** Whether the user has suppressed this holiday entirely. */
  hidden: boolean;
  /** The stored answer, or `null`, as {@link HolidayObserverCandidate} has. */
  explicit: boolean | null;
  /** The effective answer, which the UI and the engine act on. */
  observes: boolean;
}

/** One row of a picker save. */
export interface ObserverDecision {
  bearerType: ObservanceBearerType;
  bearerId: string;
  observes: boolean;
}

/** What implicit observance is read from: each living person's affiliations,
 *  and which person is you. */
export interface ImplicitObservance {
  people: ReadonlyMap<string, PersonAffiliations>;
  selfId: string | null;
}

/** Nobody observes implicitly. */
const NO_IMPLICIT: ImplicitObservance = { people: new Map(), selfId: null };

export interface HolidaysApiDeps {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  people: PeopleRepo;
  pets: PetsRepo;
  reminderRules: ReminderRulesRepo;
  /** Omitted: nobody observes a holiday until they're added. */
  implicit?: () => Promise<ImplicitObservance>;
  /** Composes a whole picker save into one transaction. */
  driver: SqliteDriver;
  /** The viewer's local civil date; injectable for tests. */
  today?: () => CivilDate;
}

/**
 * Every observer of every unhidden holiday, implicit or explicit, with its
 * occurrences from `BELATED_DAYS` ago out to the widest lead time in use.
 */
export async function holidayReminderCandidates(deps: {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  reminderRules: ReminderRulesRepo;
  implicit?: () => Promise<ImplicitObservance>;
  today: CivilDate;
}): Promise<HolidayOccurrenceCandidate[]> {
  const [rows, hidden, observances, rules, implicit] = await Promise.all([
    deps.holidays.list(),
    deps.hiddenHolidays.listHiddenIds(),
    deps.observances.list(),
    deps.reminderRules.listWhere({
      where: "bearer_type = ?",
      params: ["observance"],
    }),
    deps.implicit?.() ?? NO_IMPLICIT,
  ]);

  const resolver = createHolidayResolver(
    rows.map((row) => ({
      slug: row.slug,
      recurrence: parseRecurrence(row.recurrence),
    })),
  );

  const maxOffset = Math.max(
    0,
    ...observanceDefaultReminderSchedule.map((r) => r.offsetDays),
    ...rules.map((r) => r.offsetDays),
  );
  const horizon = MAX_ACTIVE_DAYS + maxOffset;

  const candidates: HolidayOccurrenceCandidate[] = [];
  for (const holiday of rows) {
    if (hidden.has(holiday.id)) continue;
    const occurrences = resolver.upcomingOccurrences(
      holiday.slug,
      deps.today,
      horizon,
      BELATED_DAYS,
    );
    if (occurrences.length === 0) continue;

    const stored = observances.filter((o) => o.holidayId === holiday.id);
    for (const observer of observersOf(holiday, stored, implicit)) {
      candidates.push({
        observanceId: observanceIdFor(
          holiday.id,
          observer.bearerType,
          observer.bearerId,
        ),
        greeting: holiday.greeting,
        // The bare noun, “Christmas”, beside the greeting “a Merry Christmas”.
        occasion: holiday.name,
        bearerType: observer.bearerType,
        bearerId: observer.bearerId,
        wishByDefault: wishByDefaultOf(holiday, observer.bearerId, implicit),
        occurrences: [...occurrences],
      });
    }
  }
  return candidates;
}

/** The key an observance is addressed by within one holiday. */
function bearerKey(bearerType: ObservanceBearerType, bearerId: string): string {
  return `${bearerType}:${bearerId}`;
}

/** The bearer id a {@link bearerKey} was made from. */
function keyId(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

/** The living people who keep a catalog holiday because an affiliation of
 *  theirs matches it, as bearer keys. */
function implicitObservers(
  holiday: Pick<Holiday, "slug" | "origin">,
  implicit: ImplicitObservance,
): ReadonlySet<string> {
  const keptBy =
    holiday.origin === "catalog" ? affiliationsFor(holiday.slug) : null;
  const keys = new Set<string>();
  if (keptBy === null) return keys;
  for (const [personId, affiliations] of implicit.people)
    if (isAffiliated(keptBy, affiliations))
      keys.add(bearerKey("person", personId));
  return keys;
}

/** Everyone who observes a holiday: those who said so, and those it's
 *  implied for who haven't said otherwise. */
function observersOf(
  holiday: Pick<Holiday, "slug" | "origin">,
  stored: readonly {
    bearerType: ObservanceBearerType;
    bearerId: string;
    observes: boolean;
  }[],
  implicit: ImplicitObservance,
): { bearerType: ObservanceBearerType; bearerId: string }[] {
  const said = new Set(stored.map((o) => bearerKey(o.bearerType, o.bearerId)));
  const implied = [...implicitObservers(holiday, implicit)]
    .filter((key) => !said.has(key))
    .map((key) => ({ bearerType: "person" as const, bearerId: keyId(key) }));
  return [...stored.filter((o) => o.observes), ...implied];
}

/** Whether a bearer's wish is on before any schedule is stored. You are never
 *  on your own wish list. */
function wishByDefaultOf(
  holiday: Pick<Holiday, "slug" | "origin">,
  bearerId: string,
  implicit: ImplicitObservance,
): boolean {
  return (
    holiday.origin === "catalog" &&
    wishByDefaultFor(holiday.slug) &&
    bearerId !== implicit.selfId
  );
}

/** Who observes implicitly, or nobody when the deps don't say. */
function implicitOf(deps: HolidaysApiDeps): Promise<ImplicitObservance> {
  return deps.implicit?.() ?? Promise.resolve(NO_IMPLICIT);
}

/** One read of each table, a resolver and the lookups the views need; three
 *  queries however large the catalog grows. */
async function loadCatalog(deps: HolidaysApiDeps): Promise<{
  rows: Awaited<ReturnType<HolidaysRepo["list"]>>;
  resolver: HolidayResolver;
  hidden: Set<string>;
  observerCounts: Map<string, number>;
}> {
  const [rows, hidden, observances, implicit] = await Promise.all([
    deps.holidays.list(),
    deps.hiddenHolidays.listHiddenIds(),
    deps.observances.list(),
    implicitOf(deps),
  ]);

  const resolver = createHolidayResolver(
    rows.map((row) => ({
      slug: row.slug,
      recurrence: parseRecurrence(row.recurrence),
    })),
  );

  const observerCounts = new Map(
    rows.map((row) => [
      row.id,
      observersOf(
        row,
        observances.filter((o) => o.holidayId === row.id),
        implicit,
      ).length,
    ]),
  );

  return { rows, resolver, hidden, observerCounts };
}

export function createHolidaysApi(deps: HolidaysApiDeps) {
  const now = deps.today ?? todayCivil;

  return {
    /** Every holiday, soonest first, hidden ones last but listed, so they can
     *  be unhidden. */
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

    /** One holiday with its next few dates, or undefined. */
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

    /** Every date a holiday falls on in one Gregorian year, as ISO; a
     *  lunisolar one can fall twice or not at all. */
    async occurrencesIn(holidayId: string, year: number): Promise<string[]> {
      const { rows, resolver } = await loadCatalog(deps);
      const row = rows.find((r) => r.id === holidayId);
      if (row === undefined) return [];
      return resolver.occurrencesFor(row.slug, year).map(isoFromCivil);
    },

    /** Every person and pet with their answer for this holiday, so the picker
     *  can add the first observer. */
    async listObservers(
      holidayId: string,
    ): Promise<HolidayObserverCandidate[]> {
      const [people, pets, stored, holiday, implicitSource] = await Promise.all(
        [
          deps.people.list(),
          deps.pets.list(),
          deps.observances.listForHoliday(holidayId),
          deps.holidays.get(holidayId),
          implicitOf(deps),
        ],
      );

      const explicitByKey = new Map(
        stored.map((row) => [
          bearerKey(row.bearerType, row.bearerId),
          row.observes,
        ]),
      );
      const implicit =
        holiday === undefined
          ? new Set<string>()
          : implicitObservers(holiday, implicitSource);

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
          // An explicit answer always wins over the implicit one.
          observes: explicit ?? implicit.has(key),
        };
      });

      return candidates.sort((a, b) => a.label.localeCompare(b.label));
    },

    /** Every holiday with one bearer's answer, hidden ones included, from one
     *  snapshot; skips `loadCatalog`'s observer count. */
    async listForBearer(
      bearerType: ObservanceBearerType,
      bearerId: string,
    ): Promise<BearerHolidayCandidate[]> {
      const [rows, hidden, stored, implicitSource] = await Promise.all([
        deps.holidays.list(),
        deps.hiddenHolidays.listHiddenIds(),
        deps.observances.listForBearer(bearerType, bearerId),
        implicitOf(deps),
      ]);

      const resolver = createHolidayResolver(
        rows.map((row) => ({
          slug: row.slug,
          recurrence: parseRecurrence(row.recurrence),
        })),
      );
      const explicitByHolidayId = new Map(
        stored.map((row) => [row.holidayId, row.observes]),
      );
      const key = bearerKey(bearerType, bearerId);
      const today = now();

      const candidates = rows.map((row) => {
        const [next] = resolver.upcomingOccurrences(
          row.slug,
          today,
          LOOKAHEAD_DAYS,
        );
        const explicit = explicitByHolidayId.get(row.id) ?? null;
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
          explicit,
          // Resolved exactly as `listObservers` resolves it.
          observes: explicit ?? implicitObservers(row, implicitSource).has(key),
        };
      });

      return candidates.sort(compareForBrowse);
    },

    /** Saves a picker in one transaction, storing a row only where the answer
     *  diverges from the implicit one. */
    async setObservers(
      holidayId: string,
      decisions: readonly ObserverDecision[],
    ): Promise<void> {
      const holiday = await deps.holidays.get(holidayId);
      const implicit =
        holiday === undefined
          ? new Set<string>()
          : implicitObservers(holiday, await implicitOf(deps));
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

    /** Hides or unhides a holiday, leaving its observances intact. */
    setHidden(holidayId: string, hidden: boolean): Promise<void> {
      return deps.hiddenHolidays.setHidden(holidayId, hidden);
    },

    /** One observance's stored rules, else the defaults with the holiday's
     *  own wish default. */
    async getObservanceSchedule(
      holidayId: string,
      bearerType: ObservanceBearerType,
      bearerId: string,
    ): Promise<ReminderRuleInput[]> {
      const [stored, holiday, implicit] = await Promise.all([
        deps.reminderRules.listForBearer(
          "observance",
          observanceIdFor(holidayId, bearerType, bearerId),
        ),
        deps.holidays.get(holidayId),
        implicitOf(deps),
      ]);
      return resolveObservanceReminderSchedule(
        stored,
        holiday !== undefined && wishByDefaultOf(holiday, bearerId, implicit),
      );
    },

    /** Replaces one observance's schedule, even with the defaults. Anything
     *  on says they observe it; turning things off says nothing either way. */
    setObservanceSchedule(
      holidayId: string,
      bearerType: ObservanceBearerType,
      bearerId: string,
      rules: ReminderRuleInput[],
    ): Promise<void> {
      return deps.driver.transaction(async () => {
        await deps.reminderRules.replaceForBearer(
          "observance",
          observanceIdFor(holidayId, bearerType, bearerId),
          rules,
        );
        if (rules.some((r) => r.enabled))
          await deps.observances.setObservance(
            holidayId,
            bearerType,
            bearerId,
            true,
          );
      });
    },
  };
}

/** The fields {@link compareForBrowse} reads. */
type BrowseSortable = Pick<
  HolidayListItem,
  "hidden" | "nextOccurrence" | "name"
>;

/** Soonest first, then undated, then hidden, by name; an undated holiday
 *  sinks rather than vanishes, so it can be diagnosed. */
function compareForBrowse(a: BrowseSortable, b: BrowseSortable): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
  if (a.nextOccurrence !== b.nextOccurrence) {
    if (a.nextOccurrence === null) return 1;
    if (b.nextOccurrence === null) return -1;
    return a.nextOccurrence < b.nextOccurrence ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
