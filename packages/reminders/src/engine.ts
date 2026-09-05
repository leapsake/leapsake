import { deterministicUuid } from "@leapsake/bytes";
import { flag } from "@leapsake/flags";
import {
  type CivilDate,
  type MilestoneBearerType,
  type RemindEligibleMilestone,
  type Reminder,
  type MilestoneKind,
  type ReminderAction,
  type ReminderRuleInput,
  type ResolvedReminderSchedule,
  actionDefOf,
  actionKeyOf,
  daysUntil,
  dueDateMs,
  kindDefs,
  mentionToken,
  nextOccurrence,
  promptOffsetDays,
  recentOccurrence,
  reminderRuleLabel,
  verbOf,
} from "@leapsake/schema";

/** Milliseconds in a civil day — a stored due date is UTC midnight, so shifting
 *  it back by whole days is exact integer subtraction (no DST drift). */
const DAY_MS = 86_400_000;

/**
 * How long a **missed** reminder lingers after its occasion has gone by.
 *
 * The engine used to drop a reminder the moment its day passed, which meant a
 * birthday you missed disappeared overnight — the app noticed and said nothing.
 * That is the one outcome worth avoiding: a list you cannot trust to tell you
 * when you dropped something is a list you stop reading. Two days is enough to
 * catch a missed day over a weekend without letting the past accumulate.
 *
 * **It bounds only the belated tail** — the state where the occasion itself has
 * passed and only acknowledgment is left. The other way to miss something,
 * *past due* (a card's post date blew, but the birthday is still Tuesday), needs
 * no dial of its own: the occurrence bounds it. See {@link isWithinWindow},
 * which computes both from the same two clauses.
 *
 * One dial for now. Per-action belated windows — a missed call is stale sooner
 * than a missed gift — are a plausible later refinement, deliberately not built
 * before there is evidence about which actions want what.
 */
export const BELATED_DAYS = 2;

/**
 * The fixed namespace all automated-reminder ids are derived under (see
 * {@link deterministicUuid}). Kept constant forever — changing it would re-mint
 * every system reminder under a new id and duplicate the lot on next sync.
 */
export const SYSTEM_REMINDER_NAMESPACE = "leapsake:system-reminder";

/**
 * The store surface the engine drives — the narrow slice of the reminders repo
 * it needs, injected so the engine unit-tests against an in-memory fake with no
 * native sqlite driver. All four already exist on the entity-repo base the
 * reminders repo spreads.
 */
export interface SystemReminderStore {
  /** Fetch by id **including tombstones** — the resurrection guard reads this so
   *  a user-dismissed (soft-deleted) system reminder is never re-created. */
  getIncludingDeleted(id: string): Promise<Reminder | undefined>;
  /** Persist an already-assembled reminder row (the engine mints id + stamps). */
  insert(row: Reminder): Promise<Reminder>;
  /**
   * Refresh a still-live system reminder's derived fields in place — used when its
   * milestone was edited (the date moved, or the subject was renamed) so the id is
   * unchanged but the title/due date drifted. Keeps the row's identity and any
   * manual completion; the store bumps `updated_at` so the edit wins LWW on sync.
   * `dueDate` is nullable so a dateless onboarding row's copy can also be refreshed
   * (see {@link ONBOARDING_STEPS}) — in practice onboarding copy is static, so this
   * path is unlikely to fire for it.
   */
  update(
    id: string,
    fields: { title: string; dueDate: number | null },
  ): Promise<void>;
  /** Active rows matching a raw snake_case `WHERE` (used for `source = 'system'`). */
  listWhere(query: {
    where: string;
    params: readonly unknown[];
  }): Promise<Reminder[]>;
  /** Soft-delete a now-stale system reminder by id. */
  softDelete(id: string): Promise<void>;
}

/**
 * Everything the engine needs, injected by the composition root. Deliberately no
 * `@leapsake/core` / `@leapsake/data` dependency: the engine speaks only to these
 * small ports, so it stays independently testable and narrowly scoped.
 */
export interface ReminderEngineDeps {
  /** The remind-relevant, plaintext, cross-bearer milestone projection reader. */
  milestones: { listRemindEligible(): Promise<RemindEligibleMilestone[]> };
  /** The system-reminder store (see {@link SystemReminderStore}). */
  reminders: SystemReminderStore;
  /**
   * The milestone's effective staggered-reminder schedule — its stored rule rows
   * when it has been customised, else its kind's defaults, already projected to
   * editable rows (schema's `resolveReminderSchedule`). The engine mints one
   * reminder per **enabled** entry; disabled entries are ignored (but still
   * returned so the caller need not filter). Injected so the engine stays free of
   * `@leapsake/data` — the composition root reads the rules repo + resolver.
   *
   * It answers with its **source** as well as its rules, and that half is not a
   * diagnostic: `kind-default` means "this occasion has no rules of its own",
   * which is precisely the condition {@link computeDesired} mints a `plan`
   * prompt on.
   */
  resolveSchedule(
    milestone: RemindEligibleMilestone,
  ): Promise<ResolvedReminderSchedule>;
  /**
   * Resolve a milestone bearer to its display label, or `null` when the bearer is
   * gone (a dangling milestone) — a null label skips the reminder.
   */
  resolveLabel(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string | null>;
  /**
   * Whether a milestone bearer is the **self-person** —
   * flips the birthday *wish* copy from "Wish @You a happy birthday" to a self-
   * directed "It's your birthday!". A single branch in the copy layer, keyed on
   * `getSelf()`, **not** a filter: your own birthday is still reminded, just
   * addressed to you. **Optional**, like `onboarding`/`holidays`, so engine unit
   * tests may omit it (the wish then always uses the third-party copy); the
   * composition root supplies it.
   */
  isSelf?(bearerType: MilestoneBearerType, bearerId: string): Promise<boolean>;
  /** The **local civil** "today" reconcile runs against (see reminder-schedule). */
  today: CivilDate;
  /** Run the reconcile body atomically (the real driver's `transaction`). */
  transaction<T>(body: () => Promise<T>): Promise<T>;
  /**
   * The first-run signals the onboarding nudges (see {@link ONBOARDING_STEPS})
   * are decided from. **Optional**: engine unit tests and any non-onboarding
   * caller may omit it, and the desired set then carries no onboarding rows. The
   * composition root reads these off its people/pets repos and sync-status.
   */
  onboarding?: {
    /** Whether the store holds any person or pet yet. */
    hasAnyEntity(): Promise<boolean>;
    /** Whether this device has connected to a sync relay. */
    isSyncConnected(): Promise<boolean>;
    /** Whether the self-person has been picked yet. */
    hasSelf(): Promise<boolean>;
    /**
     * Whether this store holds an account — the custody signal, **not** the sync
     * one. A local-only account answers `true` here and `false` to
     * {@link ReminderEngineDeps.onboarding.isSyncConnected}, and keeping the two
     * apart is what lets the sign-in nudge retire for a user who created an
     * account that never touched a relay.
     */
    hasAccount(): Promise<boolean>;
  };
  /**
   * The holiday-observance source — the second family of recurring dated facts
   * the engine generates from.
   *
   * A **parallel port rather than a widening** of `milestones`/`resolveSchedule`
   * /`resolveLabel`. Those are typed against `RemindEligibleMilestone`, and
   * generalising them would have touched every existing call site and fake for
   * no behavioural gain — with a real risk of perturbing milestone id derivation
   * in the process, which would duplicate every existing system reminder on the
   * next sync. The `onboarding` port above already proved this shape: a second
   * desired-row family feeding the same map, inheriting insert / refresh /
   * tombstone-guard / prune unchanged.
   *
   * **Optional**, like `onboarding`, so engine unit tests can omit it — but the
   * composition root always supplies it. Omitting it in production would prune
   * (and permanently tombstone) every holiday reminder.
   */
  holidays?: {
    /**
     * Every (observance × upcoming occurrence) worth considering today, already
     * narrowed to the horizon by the caller and carrying **no** bearer label —
     * the label lookup is potentially encrypted, so it stays behind the schedule
     * and window filters below. Holidays multiply the candidate set by
     * (people × holidays), so that ordering matters more here than it does for
     * milestones.
     */
    listCandidates(): Promise<HolidayOccurrenceCandidate[]>;
    resolveSchedule(
      candidate: HolidayOccurrenceCandidate,
    ): Promise<ReminderRuleInput[]>;
    resolveLabel(
      bearerType: HolidayBearerType,
      bearerId: string,
    ): Promise<string | null>;
  };
  /**
   * The unresolved duplicate-candidate pairs — the fourth family, and the only
   * one that is neither dated nor first-run-only.
   *
   * Reports just the pair **keys** (`"lower:higher"` person ids, the same
   * canonical form the `not_a_duplicate` memory uses), never names: the nudge
   * says how many pairs need review and links to the review screen, so it needs
   * no potentially-encrypted label lookup. **Optional**, like `onboarding` — omit
   * it and no duplicates row joins the set.
   */
  duplicates?: {
    pairKeys(): Promise<readonly string[]>;
  };
}

/** The entities a holiday observance can hang off. */
export type HolidayBearerType = "person" | "pet";

/** One person's observance of one holiday, with the dates it falls on. */
export interface HolidayOccurrenceCandidate {
  /** The observance row's id — the reminder's bearer, and part of its identity. */
  observanceId: string;
  /** The occasion phrase for reminder copy, e.g. "a Merry Christmas". */
  greeting: string;
  /** The occasion as a bare noun, e.g. "Christmas" — see `ReminderCopyContext`. */
  occasion: string;
  bearerType: HolidayBearerType;
  bearerId: string;
  /** The occurrence dates to consider, ascending. */
  occurrences: CivilDate[];
}

/** A reminder the engine wants to exist for today's reconcile. `dueDate` is null
 *  for the dateless onboarding nudges (see {@link ONBOARDING_STEPS}). */
interface DesiredReminder {
  id: string;
  title: string;
  dueDate: number | null;
  /**
   * The day this row goes **on display** — `dueDate` less the action's own
   * {@link ReminderActionDef.activeDays}. Null for the dateless families, which
   * are on display the moment they exist.
   *
   * Carried rather than recomputed downstream because the action is not a column
   * on `reminders`: this is the one point where the row and its action are both
   * in hand. ⚠️ It is always the action's **own** window, never the
   * {@link ActiveDaysOf} the walk was called with — that parameter decides
   * whether a row is in the desired set at all, this says when it surfaces.
   */
  activeFrom: number | null;
  /**
   * The occasion this row counts down to, as a stored due-date epoch. Null when
   * there is no occasion (the dateless families).
   *
   * It is what separates the two ways of missing something once the row leaves
   * the engine: *past due* is a blown deadline with the occasion still ahead,
   * *belated* is the occasion itself gone (see {@link isWithinWindow}). The row
   * carries `dueDate` alone, and `dueDate + offsetDays` is not recoverable from
   * it, so without this the screen cannot tell them apart.
   */
  occurrenceDate: number | null;
  /**
   * Display-priority rank among **dateless** rows: 0 = highest (shown first),
   * realized as a small `createdAt` back-off at insert so the client's
   * `compareReminderDue` — which orders undated rows newest-`createdAt`-first —
   * puts a lower rank above a higher one. Omitted (⇒ 0) for milestone rows, which
   * are dated and already order by their due date. Applied only on first insert,
   * so a steady-state reconcile never rewrites it.
   */
  order?: number;
  /**
   * Who this reminder is about and what it asks for — present only for rows with
   * a **person/pet** bearer (a milestone or holiday one), absent for onboarding
   * nudges and relationship-borne milestones. Clients read it through
   * {@link listSystemReminderTargets} to offer an action on the reminder (the
   * `gift` one opens the recipient's gifts).
   */
  target?: Omit<SystemReminderTarget, "id">;
}

/**
 * What a `system` reminder is *about*: its id paired with the action that minted
 * it and the person/pet it names. The id-convention again (see
 * {@link ONBOARDING_REMINDERS}) — a client keys its CTA off this rather than off
 * a stored column, so no schema field, no migration, no sync change.
 */
export interface SystemReminderTarget {
  id: string;
  action: ReminderAction;
  /** Always a person or pet: a relationship-borne milestone carries no target. */
  bearerType: HolidayBearerType;
  bearerId: string;
  /**
   * The milestone this row was minted from, for the rows that came from one —
   * absent on holiday-observance rows, which are borne by an observance.
   *
   * Present because a `plan` prompt is answered by writing rules against the
   * milestone, and the reminder row itself cannot say which milestone that is:
   * its bearer is the *person*, and a person can hold several occasions. The id
   * encodes it but is a one-way hash, so it has to travel.
   */
  milestone?: { id: string; kind: MilestoneKind };
  /**
   * The day this row counts down to, as a stored due-date epoch — the occasion
   * itself, not the row's own deadline.
   *
   * A prompt is the case that needs it. Every row renders its trailing distance
   * from `dueDate`, which for a prompt is *decide by*, six weeks before the
   * birthday — so the screen that asks the question has to be able to say when
   * the occasion actually is, or "in 2 weeks" reads as the birthday.
   */
  occurrenceDate?: number | null;
}

/** The identity string a milestone occurrence + rule is content-addressed under,
 *  so two devices generating "the same" reminder derive the **same** id and the
 *  existing whole-row merge dedups them (plans automated-reminders, cross-cutting).
 *  Keyed on the rule's identity (schema's `actionKeyOf` — the full
 *  `verb:qualifier`, or the label for an `other`) so a milestone's staggered
 *  reminders get distinct, non-colliding ids for the same occurrence. The action
 *  carries a colon of its own, which costs nothing: nothing ever *parses* one of
 *  these names, or the id derived from it. */
function occurrenceName(
  milestoneId: string,
  occurrenceYear: number,
  actionKey: string,
): string {
  return `milestone:${milestoneId}:${occurrenceYear}:${actionKey}`;
}

/**
 * The abstract navigation target an onboarding nudge deep-links to. Kept abstract
 * (not a concrete client path) so each client maps it to its own router — see
 * {@link onboardingRouteOf} and the client CTA tables.
 */
export type OnboardingRoute =
  | "add-person"
  | "connect-sync"
  | "create-account"
  | "pick-self";

/** The raw first-run signals an onboarding step's condition is evaluated against. */
interface OnboardingSignals {
  hasEntities: boolean;
  syncConnected: boolean;
  hasSelf: boolean;
  /** Whether this store holds an account at all — relay-bound or local-only.
   *  Distinct from `syncConnected`, which is the narrower "and it has a relay". */
  hasAccount: boolean;
}

/** One first-run nudge: a stable `key` (folded into its deterministic id), the
 *  copy shown on Home, the abstract CTA `route`, `applies` — true while the
 *  step's condition is still unmet, i.e. while the nudge should exist — and the
 *  two snooze dials below. */
interface OnboardingStep {
  key: string;
  title: string;
  route: OnboardingRoute;
  applies(s: OnboardingSignals): boolean;
  /**
   * How long a "not now" puts this step off for, in whole days off {@link DAY_MS} —
   * so a snooze runs for a fixed span from the moment it is taken, not to a civil
   * calendar date. That is the right arithmetic for a hide-until instant, and it
   * needs no civil-date math.
   */
  snoozeDurationDays: number;
  /**
   * How many *"not now"s* this step will accept before it gives up and retires
   * itself for good — so it comes back `snoozeRepetitions - 1` times. A step set
   * to **1** therefore never returns: the first "not now" spends the budget and
   * the next reconcile tombstones the row before its clock is ever read.
   *
   * That is why the floor is **2** for every step *(owner, 2026-08-01)*: at 1 the
   * gentle-looking option is the permanent one, and "don't ask again" — which is
   * withheld on a first encounter precisely so a permanent choice is never a
   * trap — is then never offered at all, because it appears only on a second
   * sighting. Read the number as *not nows accepted*, not *times it returns*;
   * the two readings differ by one and the plan's §3 table is written the other
   * way round. See {@link snoozePolicyOf}.
   */
  snoozeRepetitions: number;
}

/**
 * The onboarding nudge definitions — a second family of `system` reminders the
 * engine owns copy for, mirroring how it owns the milestone `actionDefs`. Each is
 * a dateless row surfaced while its condition is unmet and retired (soft-deleted)
 * once met. Titles are kept free of `#`/`@` tokens so the core insert-wrapper
 * materializes no tags/@mentions for them.
 *
 * **Permanent retirement is intentional:** retirement is a `softDelete` tombstone,
 * so a step does **not** re-appear if its condition later reverts (e.g. the user
 * deletes all their people). That is the correct "don't re-nag" onboarding
 * semantic — see {@link computeAndReconcile}. A step retires either because its
 * condition was met or because it ran out of {@link OnboardingStep.snoozeRepetitions};
 * both go through that one path.
 *
 * **The two snooze dials below are provisional numbers, not architecture.** They are
 * data on purpose, so changing one is editing a literal here rather than touching
 * logic. The reasoning behind the values is that the steps have unequal stakes:
 * wrongly nagging costs annoyance the user can dismiss, while wrongly silencing a
 * step costs something that gives no signal it happened — so where a step's budget
 * is unclear, it gets another repetition rather than fewer. Expect to correct them
 * once real usage disagrees.
 *
 * **Array order is display priority** (first = shown highest on Home). Sign-in
 * leads: a returning user already on another device should get back into their
 * account before re-adding anyone, so their existing data flows in rather than
 * being re-entered by hand. `create-account` sits directly beneath it because the
 * two are **one fork, read together** — see below. The order is made deterministic
 * by a per-step `createdAt` back-off at insert time (see
 * {@link computeAndReconcile}), so it doesn't hinge on insertion-tie ordering in
 * the store.
 */
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    key: "sync-devices",
    // **Sign-in vocabulary, deliberately.** "Connect to sync" is our word for
    // this, not the user's: someone who already has Leapsake elsewhere is looking
    // for *sign in*, and reading past this row to "create your account" is the
    // one wrong turn on Home that used to be a dead end. The words carry the
    // load because ordering alone cannot — both rows are on screen at once.
    title: "🔄 Already have Leapsake on another device? Sign in.",
    route: "connect-sync",
    // **Any account retires this, not just a relay-bound one.** Retiring on
    // `syncConnected` alone left a user who created a local-only account being
    // nudged toward a flow that could not satisfy the condition — the deep-link
    // lands on Settings, which has no sign-in to offer once an account exists.
    //
    // The `multiDevice` gate is the same argument one step earlier: with the
    // flag off there is no sign-in on Settings for *anyone*, so the nudge would
    // deep-link into a screen that cannot satisfy it. The invitation is the
    // feature's front door, and leaving it up while the destination is shut is
    // worse than either state. Note that flipping the flag off retires the row
    // by tombstone like any unmet step, and retirement is permanent — flipping
    // back on will not resurrect it in a profile that already saw it.
    applies: (s) => flag("multiDevice") && !s.syncConnected && !s.hasAccount,
    // A user who says "not now" here almost certainly has no other device, so
    // asking once more and then dropping it is the whole budget.
    snoozeDurationDays: 3,
    snoozeRepetitions: 2,
  },
  {
    // **The account invitation** — the other half of the fork above, and the step
    // that gets a user from Unauthenticated to Authenticated (`encryption/model.md`
    // §7.2.1). It waits for `hasEntities` because an account protects *access to
    // data*, and there is nothing to protect until some exists.
    //
    // Not a wall-clock delay, deliberately. Gating on data rather than on days
    // elapsed is what puts the invitation in front of someone who imported 200
    // contacts on day one — the moment the account matters most, and exactly the
    // moment an elapsed-time floor would mute it.
    //
    // The copy promises **access, not safety**: an Unauthenticated store is
    // plaintext with no keys, so there is nothing yet to be locked out of, and a
    // *backup* — not an account — is what survives a lost device. Saying
    // otherwise would be a guarantee the product does not make.
    key: "create-account",
    title: "🔐 Set up your login to protect the data on this device",
    route: "create-account",
    applies: (s) => s.hasEntities && !s.hasAccount,
    // **The one step that gets more than the floor.** Wrongly nagging costs
    // annoyance a user can dismiss; wrongly silencing this one leaves their data
    // in the clear with no signal that it happened — so it is the step where the
    // unequal-stakes rule above buys an extra repetition.
    snoozeDurationDays: 3,
    snoozeRepetitions: 3,
  },
  {
    key: "add-first-person",
    title: "👋 Add your first person to get started",
    route: "add-person",
    applies: (s) => !s.hasEntities,
    // Skipping this costs little: an empty app is self-evidently empty, and the
    // nudge has nothing to add once the user starts typing.
    snoozeDurationDays: 3,
    snoozeRepetitions: 2,
  },
  {
    // Pick yourself, once there's a list to pick from — the self-person is the
    // ego anchor gifts (and, later, kinship) need. It
    // sits below add-person because you can't pick yourself from an empty list.
    key: "pick-self",
    title: "🙋 Which of these is you? Pick yourself.",
    route: "pick-self",
    applies: (s) => s.hasEntities && !s.hasSelf,
    // At the floor, like everything except the account invitation: nothing else
    // tells the user that gifts (and, later, kinship) are quietly less useful
    // until this is set, but nothing is lost silently either — an unset self is
    // recoverable at any time from the People list.
    snoozeDurationDays: 3,
    snoozeRepetitions: 2,
  },
];

/** The deterministic id an onboarding step is content-addressed under — derived
 *  under the same {@link SYSTEM_REMINDER_NAMESPACE} as milestone reminders but in
 *  the disjoint `onboarding:<key>` name-space, so the two families never collide. */
function onboardingId(key: string): string {
  return deterministicUuid(SYSTEM_REMINDER_NAMESPACE, `onboarding:${key}`);
}

/** The step a reminder id belongs to — {@link onboardingId} read backwards — or
 *  `undefined` for any other reminder (user, milestone, holiday, duplicates). */
function onboardingStepOf(id: string): OnboardingStep | undefined {
  return ONBOARDING_STEPS.find((step) => onboardingId(step.key) === id);
}

/** Whether a step has used up its {@link OnboardingStep.snoozeRepetitions}. The
 *  single place that comparison is made, so "is snooze still offered" and "does
 *  the engine still want this row" can never answer it differently. */
function hasSpentItsSnoozes(
  step: OnboardingStep,
  snoozeCount: number,
): boolean {
  return snoozeCount >= step.snoozeRepetitions;
}

/**
 * The duplicates nudge's identity — content-addressed on the **set of unresolved
 * pairs** rather than on a fixed key, which is the whole trick that makes this
 * family work on rails built for the other three.
 *
 * {@link reconcile} prunes by `softDelete` and never resurrects a tombstoned id.
 * That is exactly right for onboarding ("don't re-nag") and exactly wrong here:
 * duplicates are not a first-run condition, and a new candidate pair can appear
 * at any time, years in. Keying on the sorted pair list gives each distinct set
 * of outstanding pairs its own row, so resolving one of two pairs retires the
 * old row and mints a fresh one stating the new count — and a set that empties
 * and later refills with *different* pairs lands on an id no tombstone holds.
 *
 * The one deliberate consequence: deleting the nudge outright tombstones exactly
 * that set of pairs, so it stays gone until the set changes. That reads as a
 * "dismiss this" gesture, which is the sensible meaning for a user-deleted row.
 * The People & Pets link and the per-person banners are unconditional on it, so
 * dismissal hides the nudge without hiding the work.
 *
 * Exported because clients resolve the nudge's CTA by id (the same id-convention
 * as {@link ONBOARDING_REMINDERS} and {@link listSystemReminderTargets}) — but
 * this id is not static, so `@leapsake/core` recomputes it from the live pairs.
 */
export function duplicatesReminderId(pairKeys: readonly string[]): string {
  return deterministicUuid(
    SYSTEM_REMINDER_NAMESPACE,
    `duplicates:${[...pairKeys].sort().join(",")}`,
  );
}

/** The Home copy for `n` unresolved candidate pairs. Kept free of `#`/`@` tokens
 *  so the core insert-wrapper materializes no tags or mentions for it. */
function duplicatesTitle(n: number): string {
  return n === 1
    ? "🔗 Two people might be the same — review"
    : `🔗 ${n} pairs of people might be the same — review`;
}

/**
 * The identity a holiday-observance occurrence + rule is content-addressed
 * under — the third disjoint name-space under {@link SYSTEM_REMINDER_NAMESPACE},
 * alongside `milestone:` and `onboarding:`.
 *
 * Keyed on the occurrence **date** rather than its year, unlike
 * {@link occurrenceName}. A year is a safe key for a birthday, which falls once
 * per year by construction; it is wrong for a lunisolar holiday, which can fall
 * **twice** in one Gregorian year — Ramadan did in 1997 — and would collapse
 * both occurrences onto one reminder. The date is strictly more robust and costs
 * nothing.
 */
function observanceOccurrenceName(
  observanceId: string,
  occurrenceIso: string,
  actionKey: string,
): string {
  return `observance:${observanceId}:${occurrenceIso}:${actionKey}`;
}

/** `YYYY-MM-DD` for a civil date — the occurrence key above. */
function isoOf(date: CivilDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** An onboarding reminder's stable id paired with its abstract CTA route. */
export interface OnboardingReminder {
  id: string;
  route: OnboardingRoute;
}

/**
 * The id ⇒ route convention clients look a Home reminder's CTA up against — the
 * whole point of the id-convention: no schema field, no migration, no sync change.
 * A client renders a deep-link CTA for a reminder **only** when
 * {@link onboardingRouteOf} finds a match here.
 */
export const ONBOARDING_REMINDERS: readonly OnboardingReminder[] =
  ONBOARDING_STEPS.map((step) => ({
    id: onboardingId(step.key),
    route: step.route,
  }));

/** The CTA route for a reminder id, or `null` when it isn't an onboarding
 *  reminder (a milestone or user reminder) — the client's branch for "show a CTA". */
export function onboardingRouteOf(id: string): OnboardingRoute | null {
  return ONBOARDING_REMINDERS.find((r) => r.id === id)?.route ?? null;
}

/**
 * How long a `plan` prompt is put off for, and how many times.
 *
 * The prompt is the first row outside onboarding to offer *not now*, and it
 * needs one for a reason the other reminders do not have: it is a **question**,
 * and an unanswered question stays alive to the occurrence — so an ignored one
 * would sit in *past due*, and therefore in `owed`, for the whole six weeks
 * between its due date and the birthday. That is a wall, and the README's rule
 * is *a nudge, never a wall*.
 *
 * Two repetitions is the same floor the onboarding steps take, for the same
 * reason recorded there: at one, the gentle-looking option is the permanent one,
 * and *don't ask again* — withheld on a first encounter so a permanent choice is
 * never a trap — would never be offered at all.
 *
 * Data, not architecture. Changing either is editing a literal.
 */
const PLAN_PROMPT_SNOOZE_DAYS = 7;
const PLAN_PROMPT_SNOOZE_REPETITIONS = 2;

/** The outcome of snoozing a reminder right now. */
export interface SnoozePolicy {
  /** When the snooze would run to — epoch ms, UTC. */
  until: number;
}

/**
 * Whether a reminder can still be put off, and if so until when — **one**
 * evaluation answering both, so the offer and its date can never disagree.
 *
 * `null` means *don't offer snooze*, for either of two reasons the caller does not
 * need to tell apart: the reminder is neither an onboarding nudge nor a `plan`
 * prompt (a user, milestone, holiday or duplicates row — putting an ordinary
 * reminder off is its own unbuilt affordance), or it has spent its repetitions
 * and is about to retire. Otherwise the answer carries the target date, so the
 * offered action can hand it straight to the one write method and the copy can
 * say *"ask me in 3 days"* with no second derivation.
 *
 * ⚠️ **A prompt's snooze is clamped to its own due date, while that is still
 * ahead.** The due date is a real deadline, not a preference: it is the last day
 * on which ticking "get a gift" still leaves the gift its full run-up, so a
 * plain seven-day *not now* offered a week before it would silently forfeit the
 * long-lead options. Past the deadline there is nothing left to protect and the
 * only thing that matters is keeping the question answerable to the occurrence,
 * so it snoozes the full period. A first *not now* from *available* therefore
 * lands exactly on the due date, which is also the honest thing for it to mean.
 *
 * Pure, and `now` is a parameter rather than a clock read: the policy is applied
 * at the moment the user asks, never inside a reconcile, which runs on a schedule
 * and must leave an existing snooze alone.
 *
 * It lives here, beside {@link ONBOARDING_STEPS}, because the dials it reads are
 * module-private — the same seam `@leapsake/view-models` already crosses for
 * {@link onboardingRouteOf}.
 */
export function snoozePolicyOf(
  reminder: {
    id: string;
    snoozeCount: number;
    /** The prompt's own deadline, for the clamp above. */
    dueDate?: number | null;
    /** Whether this row is a `plan` prompt — the caller knows, the id cannot say. */
    isPlanPrompt?: boolean;
  },
  now: number,
): SnoozePolicy | null {
  const step = onboardingStepOf(reminder.id);
  if (step !== undefined) {
    if (hasSpentItsSnoozes(step, reminder.snoozeCount)) return null;
    return { until: now + step.snoozeDurationDays * DAY_MS };
  }
  if (reminder.isPlanPrompt !== true) return null;
  if (reminder.snoozeCount >= PLAN_PROMPT_SNOOZE_REPETITIONS) return null;
  const until = now + PLAN_PROMPT_SNOOZE_DAYS * DAY_MS;
  const due = reminder.dueDate;
  return {
    until:
      due !== null && due !== undefined && due > now
        ? Math.min(until, due)
        : until,
  };
}

/**
 * Whether a rule's reminder is **alive** today — the single test the whole
 * engine reads, and the only place the two ways of missing something are
 * distinguished.
 *
 * `daysUntilOccurrence` is `daysUntil(today, occurrence)`, so the rule's own due
 * date is `daysUntilOccurrence - offsetDays` away. Two clauses:
 *
 * ```
 * daysUntilDue = daysUntilOccurrence - offsetDays
 * alive  =  daysUntilDue <= activeDays  &&  daysUntilOccurrence >= -BELATED_DAYS
 * ```
 *
 * The first opens the window: a reminder goes on display `activeDays` before it
 * comes due, and that number is a property of the **action** (a gift is a
 * project; a phone call is not), which is why it is passed in rather than being
 * one constant for everything. It used to be one constant for everything, and
 * that is precisely why every birthday in the next month sat on Home all month.
 *
 * The second closes it, and note that it tests the **occurrence**, not the due
 * date. That is deliberate: an unbought gift due twelve days before a birthday
 * should stay on your list right up to the birthday, not vanish when its own
 * deadline slips.
 *
 * Between them the two clauses name both missed states, with nothing stored and
 * nothing extra computed:
 *
 * - **past due** — `daysUntilDue < 0` while the occurrence is still ahead. The
 *   deadline blew but it is still salvageable (pay for express postage). Needs
 *   no dial, because the occurrence bounds it.
 * - **belated** — `daysUntilOccurrence < 0`. The occasion has passed and only
 *   acknowledgment is left; {@link BELATED_DAYS} bounds how long that lingers.
 *
 * A day-of action (offset 0) can never be past due — its due date *is* the
 * occurrence — so it goes straight from due to belated. It falls out per action
 * with no configuration.
 *
 * `activeDays` is a parameter rather than a lookup because two callers want
 * different answers from the same walk: materialization asks "what should be a
 * *row* today" (each action's own window), while notification planning asks
 * "what will come due before the schedule needs refreshing" and substitutes one
 * uniform {@link NOTIFICATION_WINDOW_DAYS} for every action. Conflating them
 * would either flood the list or starve the schedule.
 */
function isWithinWindow(
  daysUntilOccurrence: number,
  offsetDays: number,
  activeDays: number,
): boolean {
  return (
    daysUntilOccurrence - offsetDays <= activeDays &&
    daysUntilOccurrence >= -BELATED_DAYS
  );
}

/**
 * How long a reminder for a given action stays on display, in days before its
 * due date — the window {@link isWithinWindow} opens.
 *
 * A function rather than a number so one walk serves both callers: materialization
 * answers with the action's own {@link actionDefs} entry, notification planning
 * with one uniform horizon for every action.
 */
type ActiveDaysOf = (action: ReminderAction) => number;

/** The materialization window: every action's own declared run-up. */
const ownActiveDays: ActiveDaysOf = (action) => actionDefOf(action).activeDays;

/**
 * Compute the set of `system` reminders that *should* exist for `today` and
 * reconcile the store to it, **idempotently** and **tombstone-respectingly**:
 *
 * - For each milestone with a nearby occurrence — the one coming, and the one
 *   just gone — resolve its staggered schedule (stored rules, else kind
 *   defaults) and, for every **enabled** rule that {@link isWithinWindow} says
 *   is alive today, derive a deterministic id (keyed on the rule's action) and
 *   desired row.
 * - Insert each desired row **when absent** — `getIncludingDeleted` means a
 *   user-dismissed reminder (a tombstone under that id) is left dead, never
 *   resurrected.
 * - **Refresh** an already-present *active* row whose title/due date has drifted
 *   (the milestone's date moved or the subject was renamed), keeping its identity
 *   and any manual completion. When nothing drifted it is left byte-for-byte
 *   as-is, so a steady-state reconcile writes nothing (no sync churn).
 * - Soft-delete every **active** `source="system"` row whose id is no longer
 *   desired — its milestone was deleted, its occurrence passed, or it fell out of
 *   the window.
 *
 * Returns how many rows it created, updated, and removed. Runs at boot/focus and
 * after every milestone write (folded into core's milestone methods, so an added
 * / edited / deleted birthday reconciles at once); the caller kicks the refresh /
 * sync path when any count is non-zero, letting normal sync push the rows.
 */
export async function regenerateSystemReminders(
  deps: ReminderEngineDeps,
): Promise<{ created: number; updated: number; removed: number }> {
  return reconcile(deps, await computeDesired(deps, ownActiveDays));
}

/**
 * What every `system` reminder that should exist today is *about* — the same
 * walk {@link regenerateSystemReminders} reconciles against, read-only.
 *
 * Deliberately the **same computation**, not a parallel one: a client's CTA must
 * light up on exactly the reminders the engine minted, and a second
 * implementation of the id derivation or the window filter would drift the day
 * either changed, silently dropping every CTA. Rows with no person/pet bearer
 * (onboarding nudges, relationship-borne milestones) carry no target and are
 * omitted here.
 */
export async function listSystemReminderTargets(
  deps: ReminderEngineDeps,
): Promise<SystemReminderTarget[]> {
  const desired = await computeDesired(deps, ownActiveDays);
  return [...desired.values()].flatMap((row) =>
    row.target === undefined
      ? []
      : [{ id: row.id, occurrenceDate: row.occurrenceDate, ...row.target }],
  );
}

/**
 * How far ahead {@link listNotifiableReminders} looks — deliberately **one
 * year**, and not a tuning knob.
 *
 * Every recurring fact this app tracks (birthdays, anniversaries, holidays)
 * comes round once a year, so a year covers each of them exactly once.
 * Stretching further would schedule a *second* copy of the same birthday, which
 * is pure waste: it spends a scarce OS notification slot on content that will
 * be re-planned long before it could fire. Shortening it would leave a user who
 * hasn't opened the app in a while with nothing scheduled at all.
 *
 * Distinct from the per-action `activeDays` that governs what becomes a *row* —
 * see {@link isWithinWindow} for why the two must not be conflated.
 */
export const NOTIFICATION_WINDOW_DAYS = 365;

/**
 * How far ahead the **reminder list** looks — the horizon behind Home's *coming*
 * section, and the second window this engine keeps.
 *
 * Distinct from {@link NOTIFICATION_WINDOW_DAYS}, which asks a different
 * question (what could come due before the schedule is next rebuilt) and answers
 * it with a year. This one asks what is worth *previewing* to someone looking at
 * the list right now, so a month: far enough to see the gift project forming,
 * near enough that the expander is a short list rather than a second inbox.
 *
 * ⚠️ **It must stay at or above `MAX_ACTIVE_DAYS`** (`@leapsake/schema`). Every
 * row the materialization walk mints is one whose own `activeDays` has opened,
 * so a shorter horizon here would drop already-existing rows out of the read
 * that feeds the screen — a reminder that exists, is on display by its own rule,
 * and is nowhere to be seen. `test/engine.test.ts` asserts it rather than
 * trusting this paragraph.
 *
 * Expected to widen, and possibly to grade (this week → this month → beyond).
 * One constant, so widening it is editing a literal.
 */
export const DISPLAY_WINDOW_DAYS = 30;

/**
 * What the engine knows about a row's timing that the stored row cannot say.
 *
 * Both dates are **derived, never persisted**: `reminders` has no action column,
 * so neither is recoverable from a row on its own, and storing them would make
 * every `actionDefs` edit a data migration. They ride along on the read instead.
 */
export interface ReminderWindowFacts {
  /**
   * When this row goes on display — see {@link DesiredReminder.activeFrom}. Null
   * means *already on display*: a dateless nudge, or a user reminder, which is a
   * row from the moment it is written and has no run-up.
   */
  activeFrom: number | null;
  /** The occasion it counts down to, or null when it has none (user rows, nudges). */
  occurrenceDate: number | null;
  /**
   * Whether a row actually exists in the store. `false` marks a **preview** —
   * synthesized below, beyond the materialization horizon — which has no state to
   * edit, nothing to remove, and no tags or mentions to join.
   */
  materialized: boolean;
}

/** A reminder paired with what the engine knows about its timing. */
export type WindowedReminder = Reminder & ReminderWindowFacts;

/**
 * Every reminder that falls within `windowDays`, whether or not it is a row yet
 * — the read-only, longer-sighted sibling of {@link regenerateSystemReminders},
 * and the one walk both the notification planner and the reminder list read
 * from.
 *
 * The problem it solves: a `system` reminder is not a row until its own action
 * says it should be on display — day-of for a wish — so reading stored rows
 * alone can only ever see a few days ahead, and that horizon advances only when
 * the app is opened. This walks the same occurrence computation over a wider
 * window and answers with rows that *will* exist, without writing any of them.
 *
 * **Nothing is persisted.** Widening the materialization window instead would
 * flood the reminder list with a year of future rows and sync them to every
 * device; how far the list looks ahead is a product decision that stays with
 * each action's own `activeDays`, and what is merely *previewed* is
 * {@link DISPLAY_WINDOW_DAYS}.
 *
 * Three states a desired id can be in, and why each is handled the way it is:
 *
 * - **A live row already** — return the real row, so a completion, a snooze, or
 *   an edited title is reflected. Planning off the synthesized copy would
 *   re-notify for something already dealt with.
 * - **A tombstone** — skip it. Same resurrection guard {@link reconcile}
 *   applies: a reminder the user dismissed must not come back as a
 *   notification, and the id stays in the desired set until its occurrence
 *   passes, so this is the common case rather than an edge one.
 * - **Absent** — synthesize it. It is beyond the materialization horizon, so it
 *   has no state to preserve: un-completed, un-snoozed, alive. Its id is the
 *   same deterministic one the row will be minted under, so a notification
 *   scheduled now still deep-links correctly once the row exists — and a
 *   completion ticked against it materializes that very row (see
 *   {@link materializeReminder}).
 *
 * `user` reminders need none of this: they are rows the moment they are
 * created, at any due date, so they are read straight from the store and carry
 * no window facts.
 *
 * Costs one point lookup per desired id, mirroring what {@link reconcile}
 * already pays — but over a wider window, so up to ~12× the ids. If that ever
 * shows up in a profile, the fix is a bulk id fetch, not a narrower window.
 */
export async function listRemindersInWindow(
  deps: ReminderEngineDeps,
  windowDays: number,
): Promise<WindowedReminder[]> {
  // One uniform horizon for every action: the question here is not
  // "what belongs on the list today" but "what falls inside this window",
  // and that has no per-action answer. Each row still reports its own
  // `activeFrom`, which is the per-action half.
  const desired = await computeDesired(deps, () => windowDays);

  const rows: WindowedReminder[] = [];
  for (const want of desired.values()) {
    const existing = await deps.reminders.getIncludingDeleted(want.id);
    if (existing !== undefined) {
      if (existing.deletedAt === null)
        rows.push({ ...existing, ...factsOf(want, true) });
      continue;
    }
    rows.push({ ...synthesize(want), ...factsOf(want, false) });
  }

  const userRows = await deps.reminders.listWhere({
    where: "source = ?",
    params: ["user"],
  });
  return [
    ...rows,
    ...userRows.map((row) => ({
      ...row,
      activeFrom: null,
      occurrenceDate: null,
      materialized: true,
    })),
  ];
}

/**
 * Every reminder a device should consider **notifying** about — a year of them,
 * most not yet rows. The input `@leapsake/notifications`' `planNotifications`
 * plans from, and the reason {@link listRemindersInWindow} takes a window at all:
 * see {@link NOTIFICATION_WINDOW_DAYS} for why a year, and
 * {@link DISPLAY_WINDOW_DAYS} for the shorter one the list reads.
 */
export function listNotifiableReminders(
  deps: ReminderEngineDeps,
): Promise<WindowedReminder[]> {
  return listRemindersInWindow(deps, NOTIFICATION_WINDOW_DAYS);
}

/** The window facts a desired row reports, once its store state is known. */
function factsOf(
  want: DesiredReminder,
  materialized: boolean,
): ReminderWindowFacts {
  return {
    activeFrom: want.activeFrom,
    occurrenceDate: want.occurrenceDate,
    materialized,
  };
}

/**
 * Bring one desired-but-not-yet-materialized reminder into being, and answer
 * whether a live row now exists under that id.
 *
 * This is what makes a *coming* row tickable. The list deliberately shows rows
 * ahead of their own `activeDays` — the window governs when the app **prompts**
 * you, never what you are allowed to do early — so a checkbox on a preview row
 * has to be able to create the thing it is ticking.
 *
 * ⚠️ **What happens next is worth knowing.** The row it inserts is not in the
 * *materialization* desired set yet, so the next {@link regenerateSystemReminders}
 * prunes it — to a tombstone, which is never resurrected. Completing an errand
 * early therefore retires it for the rest of the year rather than letting it
 * come back when its window opens. That is the intended reading ("already bought
 * it, stop asking") and it is asserted in the integration tests, but it is
 * permanent, and any future "reopen" affordance has to reckon with it.
 *
 * Returns `false` only for an id the walk does not want (a stale link) or one
 * the user has already dismissed — in both cases there is deliberately nothing
 * to write.
 */
export async function materializeReminder(
  deps: ReminderEngineDeps,
  id: string,
): Promise<boolean> {
  const existing = await deps.reminders.getIncludingDeleted(id);
  if (existing !== undefined) return existing.deletedAt === null;

  const desired = await computeDesired(deps, () => DISPLAY_WINDOW_DAYS);
  const want = desired.get(id);
  if (want === undefined) return false;

  await insertDesired(deps, want, Date.now());
  return true;
}

/**
 * Mint the row for a desired reminder. Shared by {@link reconcile} and
 * {@link materializeReminder} so the two can never disagree about the shape of a
 * freshly minted row — in particular the `createdAt` back-off that carries a
 * dateless row's display rank.
 */
function insertDesired(
  deps: ReminderEngineDeps,
  want: DesiredReminder,
  now: number,
): Promise<unknown> {
  return deps.reminders.insert({
    id: want.id,
    title: want.title,
    body: null,
    completedAt: null,
    dueDate: want.dueDate,
    // Minted un-snoozed; snoozing is a user act, never a reconcile one.
    snoozedUntil: null,
    snoozeCount: 0,
    source: "system",
    // Back off `createdAt` by the row's display rank so dateless rows sort
    // in priority order on Home (newest-first tiebreak); dated milestone
    // rows omit `order`, so this is a no-op for them.
    createdAt: now - (want.order ?? 0),
    updatedAt: now,
    deletedAt: null,
  });
}

/**
 * A desired row as it *would* be minted, for a reminder that has no row yet.
 * Only the fields the notification planner reads are meaningful; the
 * bookkeeping stamps are filled with values true of a not-yet-existing row
 * rather than invented ones, so this can never be mistaken for something
 * persisted.
 */
function synthesize(want: DesiredReminder): Reminder {
  return {
    id: want.id,
    title: want.title,
    body: null,
    completedAt: null,
    dueDate: want.dueDate,
    snoozedUntil: null,
    snoozeCount: 0,
    source: "system",
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
  };
}

async function computeDesired(
  deps: ReminderEngineDeps,
  activeDaysOf: ActiveDaysOf,
): Promise<Map<string, DesiredReminder>> {
  const milestones = await deps.milestones.listRemindEligible();

  // The desired set, keyed by (deterministic) id so duplicate identities collapse.
  const desired = new Map<string, DesiredReminder>();
  for (const m of milestones) {
    // **Two occurrences, not one.** A recurring occurrence flips to next year's
    // date the morning after it passes, so a forward-only walk can never report
    // "yesterday" — a missed birthday would simply vanish overnight. Looking
    // back as well is what gives {@link isWithinWindow}'s belated clause
    // something to be true about. `recentOccurrence` answers strictly *before*
    // today, so the two can never name the same day and no occurrence is
    // considered twice.
    const occurrences = [
      recentOccurrence(m.kind, m, deps.today, BELATED_DAYS),
      nextOccurrence(m.kind, m, deps.today),
    ].filter((occ) => occ !== null);
    if (occurrences.length === 0) continue;

    // Resolved once per milestone rather than per occurrence, and the schedule
    // is read before the label so the (potentially encrypted) label lookup is
    // skipped entirely when nothing is in window. Same ordering as the holiday
    // walk below, for the same reason.
    const resolved = await deps.resolveSchedule(m);
    // **The engine never guesses.** An occasion with no rules of its own gets a
    // question rather than errands: one `plan` row, well ahead of everything the
    // question offers, asking how the user wants to mark it. Answering writes
    // ordinary rules, which flips the source to `stored`, which is what stops it
    // being asked again.
    //
    // Synthesized as an ordinary rule rather than as a branch of its own, so it
    // inherits the window filter, the id derivation, the copy layer, the insert
    // /refresh/prune and the tombstone guard below with no second code path.
    // Whether a kind asks at all is `kindDefs[kind].prompt`; when it is due is
    // derived from what it offers (`promptOffsetDays`), never chosen.
    const prompt = kindDefs[m.kind].prompt;
    const schedule: ReminderRuleInput[] =
      resolved.source === "kind-default" && prompt !== undefined
        ? [
            {
              action: "plan",
              label: null,
              offsetDays: promptOffsetDays(m.kind),
              enabled: true,
            },
            ...resolved.rules,
          ]
        : resolved.rules;
    let subject: string | undefined;
    let bearerIsSelf = false;

    for (const occ of occurrences) {
      const days = daysUntil(deps.today, occ);
      // The rules that actually want a reminder for this occurrence today:
      // enabled, and alive on their own action's window.
      const rules = schedule.filter(
        (r) =>
          r.enabled &&
          isWithinWindow(days, r.offsetDays, activeDaysOf(r.action)),
      );
      if (rules.length === 0) continue;

      if (subject === undefined) {
        const label = await deps.resolveLabel(m.bearerType, m.bearerId);
        if (label === null) break; // bearer gone — nothing to name the reminder
        // Wrap the subject in an inline mention token so the name links to the
        // person/pet page (the reminder text is the single source of truth for the
        // mention; core re-derives the backlink from it). A relationship bearer has
        // no single entity to point at, so it stays plain text — though in practice a
        // relationship never reaches here (its label resolves to null above).
        subject =
          m.bearerType === "relationship"
            ? label
            : mentionToken(label, m.bearerType, m.bearerId);
        // Is this milestone's bearer *you*? A single copy-layer branch (below)
        // flips the birthday wish to self-directed rather than filtering your own
        // birthday out — you are not excluded. Only a person can be self, and
        // only when the port is supplied.
        bearerIsSelf =
          m.bearerType === "person" && deps.isSelf !== undefined
            ? await deps.isSelf(m.bearerType, m.bearerId)
            : false;
      }

      for (const rule of rules) {
        const id = deterministicUuid(
          SYSTEM_REMINDER_NAMESPACE,
          occurrenceName(m.id, occ.year, actionKeyOf(rule)),
        );
        const def = actionDefOf(rule.action);
        let title: string;
        if (
          bearerIsSelf &&
          verbOf(rule.action) === "wish" &&
          m.kind === "birthday"
        ) {
          // Your own birthday — addressed *to* you, so no "@You" mention token and
          // a celebratory icon in place of "Wish @You a happy birthday".
          title = "🎂 It's your birthday!";
        } else if (bearerIsSelf && verbOf(rule.action) === "plan") {
          // Same branch, same reason: "How do you want to mark @You's birthday?"
          // is the third person about the second. Keyed on a fact about the
          // bearer, never on identity — the row is still `...:plan`.
          title = `${def.icon ?? ""} How do you want to mark your own ${
            kindDefs[m.kind].prompt?.occasion ?? kindDefs[m.kind].label
          }?`.trim();
        } else {
          // The action's copy carries the (mention-wrapped) subject — "Wish @Alice a
          // happy birthday", "Get @Alice a gift". `other` has no template; it is the
          // user's own free text, so it names no subject (nothing to interpolate).
          const body =
            verbOf(rule.action) === "other"
              ? reminderRuleLabel({
                  action: rule.action,
                  label: rule.label ?? null,
                })
              : def.template({
                  subject,
                  greeting: kindDefs[m.kind].greeting,
                  // Only `plan` reads this today. Falling back to the kind's own
                  // label keeps the context total for the kinds that never
                  // prompt, rather than making the field optional — see the
                  // warning on `ReminderCopyContext`.
                  occasion:
                    kindDefs[m.kind].prompt?.occasion ??
                    kindDefs[m.kind].label.toLowerCase(),
                });
          title = `${def.icon ?? ""} ${body}`.trim();
        }
        // Due `offsetDays` before the occurrence (day-of when 0); stored as UTC
        // midnight of that civil day, so plain integer subtraction is exact. A
        // belated row's due date is simply in the past, which is honest.
        const dueDate = dueDateMs(occ) - rule.offsetDays * DAY_MS;
        desired.set(id, {
          id,
          title,
          dueDate,
          activeFrom: dueDate - ownActiveDays(rule.action) * DAY_MS,
          occurrenceDate: dueDateMs(occ),
          // A relationship bearer names no single entity, so it carries no target
          // (and in practice never reaches here — its label resolves to null).
          target:
            m.bearerType === "relationship"
              ? undefined
              : {
                  action: rule.action,
                  bearerType: m.bearerType,
                  bearerId: m.bearerId,
                  milestone: { id: m.id, kind: m.kind },
                },
        });
      }
    }
  }

  // Holiday observances — the second dated family, on the same rails. A
  // candidate carries the (person, holiday) pair and the dates it falls on; each
  // (occurrence × enabled rule) becomes one reminder, exactly as a milestone's
  // occurrence does.
  //
  // Note what is deliberately NOT here: a try/catch. "Unresolvable holiday →
  // generate nothing" is a per-holiday rule, enforced upstream by the resolver
  // answering `[]` for a rule it can't make sense of — never a per-reconcile
  // one. Swallowing a failure here would hand `computeAndReconcile` a desired
  // set missing every holiday row, and the prune below would tombstone the lot
  // permanently. Letting it throw aborts the reconcile before the transaction
  // opens, having written nothing.
  if (deps.holidays !== undefined) {
    for (const candidate of await deps.holidays.listCandidates()) {
      let label: string | undefined;
      for (const occ of candidate.occurrences) {
        // No `days < 0` guard: {@link isWithinWindow} is the sole aliveness
        // test, and it holds a passed occurrence open for its belated tail. The
        // candidate list is already bounded either side by the caller.
        const days = daysUntil(deps.today, occ);

        const rules = (await deps.holidays.resolveSchedule(candidate)).filter(
          (r) =>
            r.enabled &&
            isWithinWindow(days, r.offsetDays, activeDaysOf(r.action)),
        );
        if (rules.length === 0) continue;

        // Resolved at most once per candidate, and only once something is
        // actually due — the candidate set here is (people × holidays), so a
        // label lookup per occurrence would be the N+1 this ordering exists to
        // avoid.
        if (label === undefined) {
          const resolved = await deps.holidays.resolveLabel(
            candidate.bearerType,
            candidate.bearerId,
          );
          if (resolved === null) break; // bearer gone — skip the whole candidate
          label = resolved;
        }

        const subject = mentionToken(
          label,
          candidate.bearerType,
          candidate.bearerId,
        );
        const iso = isoOf(occ);
        for (const rule of rules) {
          const id = deterministicUuid(
            SYSTEM_REMINDER_NAMESPACE,
            observanceOccurrenceName(
              candidate.observanceId,
              iso,
              actionKeyOf(rule),
            ),
          );
          const def = actionDefOf(rule.action);
          const body =
            verbOf(rule.action) === "other"
              ? reminderRuleLabel({
                  action: rule.action,
                  label: rule.label ?? null,
                })
              : def.template({
                  subject,
                  greeting: candidate.greeting,
                  occasion: candidate.occasion,
                });
          const dueDate = dueDateMs(occ) - rule.offsetDays * DAY_MS;
          desired.set(id, {
            id,
            title: `${def.icon ?? ""} ${body}`.trim(),
            dueDate,
            activeFrom: dueDate - ownActiveDays(rule.action) * DAY_MS,
            occurrenceDate: dueDateMs(occ),
            target: {
              action: rule.action,
              bearerType: candidate.bearerType,
              bearerId: candidate.bearerId,
            },
          });
        }
      }
    }
  }

  // Onboarding nudges — a second `system` family on the *same* rails: dateless
  // rows fed into the same desired set, so insert-when-absent, refresh-on-drift,
  // tombstone-guard, and prune all apply unchanged. A step whose condition is
  // unmet is desired (→ inserted); once met it drops out (→ pruned = softDelete).
  // Because prune tombstones the row, a retired step never re-appears even if its
  // condition later reverts (the user deletes all their people) — the intended
  // "don't re-nag" semantic. Running out of snoozes drops a step out of the set
  // the same way, so giving up needs no deletion path of its own. Only when the
  // caller injects the port (clients do; engine unit tests may not) — otherwise
  // no onboarding rows join the set.
  if (deps.onboarding !== undefined) {
    const signals: OnboardingSignals = {
      hasEntities: await deps.onboarding.hasAnyEntity(),
      syncConnected: await deps.onboarding.isSyncConnected(),
      hasSelf: await deps.onboarding.hasSelf(),
      hasAccount: await deps.onboarding.hasAccount(),
    };
    for (const [index, step] of ONBOARDING_STEPS.entries()) {
      if (!step.applies(signals)) continue;
      const id = onboardingId(step.key);
      // A step that has been put off as many times as it is willing to come back
      // stops being desired, and the prune below retires it the same way a met
      // condition does. The row is absent on a first run, and `snoozeCount` only
      // ever moves on a live row, so an absent row has spent nothing.
      const existing = await deps.reminders.getIncludingDeleted(id);
      if (
        existing !== undefined &&
        hasSpentItsSnoozes(step, existing.snoozeCount)
      )
        continue;
      // `index` is the step's display priority (0 = first); realized as a
      // `createdAt` back-off below so the nudges sort in array order on Home.
      // Dateless, so already on display and counting down to nothing.
      desired.set(id, {
        id,
        title: step.title,
        dueDate: null,
        activeFrom: null,
        occurrenceDate: null,
        order: index,
      });
    }
  }

  // Unresolved duplicate pairs — a fourth dateless family, one summary row for
  // however many pairs are outstanding. Ranked below the onboarding nudges: a
  // brand-new user should finish setting up before being sent to reconcile a
  // list they have barely started. See {@link duplicatesReminderId} for why the
  // id tracks the pair set rather than being a fixed key.
  if (deps.duplicates !== undefined) {
    const pairKeys = await deps.duplicates.pairKeys();
    if (pairKeys.length > 0) {
      const id = duplicatesReminderId(pairKeys);
      desired.set(id, {
        id,
        title: duplicatesTitle(pairKeys.length),
        dueDate: null,
        activeFrom: null,
        occurrenceDate: null,
        order: ONBOARDING_STEPS.length,
      });
    }
  }

  return desired;
}

/** Reconcile the store to `desired` (see {@link regenerateSystemReminders}). */
function reconcile(
  deps: ReminderEngineDeps,
  desired: Map<string, DesiredReminder>,
): Promise<{ created: number; updated: number; removed: number }> {
  return deps.transaction(async () => {
    const now = Date.now();
    let created = 0;
    let updated = 0;
    for (const [id, want] of desired) {
      const existing = await deps.reminders.getIncludingDeleted(id);
      if (existing === undefined) {
        await insertDesired(deps, want, now);
        created++;
        continue;
      }
      // A tombstone (user-dismissed) is left dead — never resurrected.
      if (existing.deletedAt !== null) continue;
      // Live row: refresh it only if the milestone drifted (date moved or subject
      // renamed), keeping its identity and any manual completion. Unchanged rows
      // are skipped, so a steady-state reconcile stays a no-op.
      if (existing.title !== want.title || existing.dueDate !== want.dueDate) {
        await deps.reminders.update(id, {
          title: want.title,
          dueDate: want.dueDate,
        });
        updated++;
      }
    }

    // Prune active system reminders that today's desired set no longer wants.
    const activeSystem = await deps.reminders.listWhere({
      where: "source = ?",
      params: ["system"],
    });
    let removed = 0;
    for (const row of activeSystem) {
      if (!desired.has(row.id)) {
        await deps.reminders.softDelete(row.id);
        removed++;
      }
    }

    return { created, updated, removed };
  });
}
