import {
  type HolidayResolver,
  createHolidayResolver,
  isoFromCivil,
  parseRecurrence,
} from "@leapsake/holidays";
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
  type HolidayOrigin,
  type ObservanceBearerType,
  type ReminderRuleInput,
  MAX_ACTIVE_DAYS,
  fullName,
  observanceDefaultReminderSchedule,
  resolveObservanceReminderSchedule,
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

/**
 * One catalog holiday paired with a single bearer's answer — the mirror of
 * {@link HolidayObserverCandidate}, for the "which holidays does this person
 * observe?" field on a Person or Pet screen.
 *
 * Deliberately **not** a {@link HolidayListItem}: `observerCount` is the one
 * field that would force a full scan of every observance in the database, and
 * this read never displays it. Everything else the field needs — the name to
 * show, the date to show beside it, and whether the holiday is hidden — is here.
 */
export interface BearerHolidayCandidate {
  id: string;
  slug: string;
  name: string;
  greeting: string;
  durationDays: number | null;
  familyId: string | null;
  origin: HolidayOrigin;
  /** The next occurrence as `YYYY-MM-DD`, or `null` — same contract as the browse list. */
  nextOccurrence: string | null;
  /** Whether the user has suppressed this holiday entirely. */
  hidden: boolean;
  /**
   * The **stored** answer, `null` when there is no row and the bearer rides the
   * implicit one. Same distinction {@link HolidayObserverCandidate} draws, and
   * for the same reason: removing an observance the user asserted is a delete,
   * while removing one they inherited implicitly is an override.
   */
  explicit: boolean | null;
  /** The effective answer — what the UI partitions on and the engine acts on. */
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
  reminderRules: ReminderRulesRepo;
  /** Composes a whole picker save into one transaction. */
  driver: SqliteDriver;
  /** The viewer's local civil date; injectable so tests aren't clock-dependent. */
  today?: () => CivilDate;
}

/**
 * Build the reminder engine's holiday candidates: every live observance paired
 * with the occurrences of its holiday that could plausibly be due.
 *
 * Three filters, in the order that keeps the work small:
 *
 * 1. **`observes: false` rows are dropped** — an explicit override is a
 *    statement that the bearer does *not* observe, so it must generate nothing.
 * 2. **Hidden holidays are dropped**, and this is why hiding has to happen here
 *    rather than only on browse surfaces: otherwise "I hid Mother's Day" still
 *    produces "Call @Violet for Mother's Day", which is worse than an ordinary
 *    bug for precisely the holiday people hide for painful reasons (§2.6).
 * 3. **Unresolvable holidays yield no occurrences** and simply contribute
 *    nothing — the row survives, per-holiday, without failing the reconcile.
 *
 * The horizon is derived from the widest lead time actually in use rather than
 * fixed, so a user who sets a 90-day gift reminder still gets it: the engine
 * surfaces a rule once its own due date (occurrence − offset) is inside that
 * action's `activeDays`, so an occurrence matters up to
 * `MAX_ACTIVE_DAYS + maxOffset` away. Taking the two maxima independently is
 * deliberately generous — this only has to **bound** the reach of any one rule,
 * and an under-estimate would silently drop occurrences rather than fail.
 *
 * The window reaches `BELATED_DAYS` into the past as well, because a missed
 * errand lingers briefly rather than vanishing overnight (`isWithinWindow` in
 * `@leapsake/reminders`). Candidates the engine will reject are cheap; an
 * occurrence never offered to it is invisible.
 */
export async function holidayReminderCandidates(deps: {
  holidays: HolidaysRepo;
  observances: ObservancesRepo;
  hiddenHolidays: HiddenHolidaysRepo;
  reminderRules: ReminderRulesRepo;
  today: CivilDate;
}): Promise<HolidayOccurrenceCandidate[]> {
  const [rows, hidden, observances, rules] = await Promise.all([
    deps.holidays.list(),
    deps.hiddenHolidays.listHiddenIds(),
    deps.observances.list(),
    deps.reminderRules.listWhere({
      where: "bearer_type = ?",
      params: ["observance"],
    }),
  ]);

  const byId = new Map(rows.map((row) => [row.id, row]));
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
  for (const observance of observances) {
    if (!observance.observes) continue;
    if (hidden.has(observance.holidayId)) continue;
    const holiday = byId.get(observance.holidayId);
    if (holiday === undefined) continue;

    const occurrences = resolver.upcomingOccurrences(
      holiday.slug,
      deps.today,
      horizon,
      BELATED_DAYS,
    );
    if (occurrences.length === 0) continue;

    candidates.push({
      observanceId: observance.id,
      greeting: holiday.greeting,
      // The bare noun beside the greeting — "Christmas" next to "a Merry
      // Christmas". Only copy that *names* the occasion reads it.
      occasion: holiday.name,
      bearerType: observance.bearerType,
      bearerId: observance.bearerId,
      occurrences: [...occurrences],
    });
  }
  return candidates;
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
     * The date(s) a holiday falls on in one Gregorian year, ISO — the reverse of
     * reading a date off an occasion, which is what lets a gift form fill
     * "Christmas" + 1941 in as 1941-12-25 (the occasion runs in
     * reverse for free).
     *
     * Usually one date. A lunisolar holiday can fall **twice** in one Gregorian
     * year or not at all, so every occurrence is returned and the choice is left
     * to the caller — the same reason the reminder engine keys occurrences on
     * date rather than on the holiday. An unknown id returns nothing.
     */
    async occurrencesIn(holidayId: string, year: number): Promise<string[]> {
      const { rows, resolver } = await loadCatalog(deps);
      const row = rows.find((r) => r.id === holidayId);
      if (row === undefined) return [];
      return resolver.occurrencesFor(row.slug, year).map(isoFromCivil);
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
     * Every holiday in the catalog with one bearer's answer — the mirror of
     * {@link listObservers}, read by the Holidays section on a Person or Pet.
     *
     * Returns the *whole* catalog rather than only what the bearer observes,
     * for the same reason `listObservers` returns the whole address book: one
     * read has to serve both the list of what they observe **and** the pool of
     * what they could add, and deriving both from one snapshot is what stops the
     * two from disagreeing.
     *
     * Hidden and unobserved entries are included. Filtering is the caller's job
     * — the field excludes hidden holidays because offering one would be
     * offering a no-op (§2.6), but a holiday the bearer already observes stays
     * listed even when hidden, or the state would be unexplainable.
     *
     * Deliberately does **not** use `loadCatalog`: that counts observers, which
     * costs a full scan of every observance in the database. This read wants one
     * bearer's rows, which `listForBearer` answers off an index.
     */
    async listForBearer(
      bearerType: ObservanceBearerType,
      bearerId: string,
    ): Promise<BearerHolidayCandidate[]> {
      const [rows, hidden, stored] = await Promise.all([
        deps.holidays.list(),
        deps.hiddenHolidays.listHiddenIds(),
        deps.observances.listForBearer(bearerType, bearerId),
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
          // Resolved exactly as `listObservers` resolves it, so the implicit
          // seam stays a single flattening pass and lights up both directions
          // together when it is eventually filled in.
          observes: explicit ?? implicitObservers(row.id).has(key),
        };
      });

      return candidates.sort(compareForBrowse);
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

    /**
     * One observance's effective reminder schedule — its stored rules if the
     * user has customised them, else {@link observanceDefaultReminderSchedule}.
     *
     * Every action ships **off**, so this is the screen that makes a holiday
     * actually do something. The read is the same "missing rows ⇒ defaults"
     * contract the milestone editor uses, which is why an untouched observance
     * still shows the full set of offered actions rather than an empty list.
     */
    async getObservanceSchedule(
      holidayId: string,
      bearerType: ObservanceBearerType,
      bearerId: string,
    ): Promise<ReminderRuleInput[]> {
      return resolveObservanceReminderSchedule(
        await deps.reminderRules.listForBearer(
          "observance",
          observanceIdFor(holidayId, bearerType, bearerId),
        ),
      );
    },

    /**
     * Replace one observance's reminder schedule.
     *
     * Note this writes rows even when the schedule still matches the defaults —
     * unlike an *observance*, where §2.2 forbids materialising a row that agrees
     * with the implicit answer. The asymmetry is deliberate and matches
     * milestones: `replaceForBearer` is a set-replace, and "the user opened the
     * editor and pressed save" is itself the signal that this schedule is now
     * authored rather than inherited. A user who wants back to defaults clears
     * the list, which stores nothing.
     */
    setObservanceSchedule(
      holidayId: string,
      bearerType: ObservanceBearerType,
      bearerId: string,
      rules: ReminderRuleInput[],
    ): Promise<void> {
      return deps.driver.transaction(() =>
        deps.reminderRules.replaceForBearer(
          "observance",
          observanceIdFor(holidayId, bearerType, bearerId),
          rules,
        ),
      );
    },
  };
}

/** The fields browse order actually depends on — see {@link compareForBrowse}. */
type BrowseSortable = Pick<
  HolidayListItem,
  "hidden" | "nextOccurrence" | "name"
>;

/**
 * Browse order: soonest first, then holidays with no upcoming date, then hidden
 * ones — with name as the stable tiebreak. Undated entries sink rather than
 * disappear so an unresolvable holiday is visible enough to be diagnosed.
 *
 * Typed on the three fields it reads rather than on `HolidayListItem`, so the
 * per-bearer read can share it without carrying `observerCount` it doesn't
 * compute.
 */
function compareForBrowse(a: BrowseSortable, b: BrowseSortable): number {
  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
  if (a.nextOccurrence !== b.nextOccurrence) {
    if (a.nextOccurrence === null) return 1;
    if (b.nextOccurrence === null) return -1;
    return a.nextOccurrence < b.nextOccurrence ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
}
