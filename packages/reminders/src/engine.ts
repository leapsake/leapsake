import { deterministicUuid } from "@leapsake/bytes";
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
  effectiveOffsets,
  isPartialAnswer,
  planOffers,
  planQuestion,
  planTiming,
  nextOccurrence,
  recentOccurrence,
  reminderRuleLabel,
  todayCivil,
  verbOf,
} from "@leapsake/schema";

/** A stored due date is UTC midnight, so whole-day shifts are exact. */
const DAY_MS = 86_400_000;

/**
 * How long a missed reminder lingers after its occasion has gone by. Past due
 * needs no dial: the occurrence bounds it (see {@link isWithinWindow}).
 */
export const BELATED_DAYS = 2;

/** Namespace for every automated-reminder id. Changing it re-mints every id
 *  and duplicates every system reminder on the next sync. */
export const SYSTEM_REMINDER_NAMESPACE = "leapsake:system-reminder";

/** The slice of the reminders repo the engine drives. */
export interface SystemReminderStore {
  /** Includes tombstones, so a dismissed system reminder is never re-minted. */
  getIncludingDeleted(id: string): Promise<Reminder | undefined>;
  /** Persist an already-assembled reminder row (the engine mints id + stamps). */
  insert(row: Reminder): Promise<Reminder>;
  /** Refresh a live row's derived copy and date, keeping its id and any manual
   *  completion; bumps `updated_at` so the edit wins LWW on sync. */
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

/** Everything the engine needs, injected by the composition root. */
export interface ReminderEngineDeps {
  /** The remind-relevant, plaintext, cross-bearer milestone projection reader. */
  milestones: { listRemindEligible(): Promise<RemindEligibleMilestone[]> };
  /** The system-reminder store (see {@link SystemReminderStore}). */
  reminders: SystemReminderStore;
  /**
   * The milestone's effective schedule; one reminder per enabled entry. A
   * `kind-default` source means no rules of its own: it mints a `plan` prompt.
   */
  resolveSchedule(
    milestone: RemindEligibleMilestone,
  ): Promise<ResolvedReminderSchedule>;
  /**
   * The bearer's display label. `null` means the bearer is gone and the row is
   * skipped, never "has no name"; a relationship names the non-self end.
   */
  resolveLabel(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<string | null>;
  /**
   * Whether a milestone is about you (the self-person or your relationship),
   * which flips its copy to the self-directed form. Omitted: third-party form.
   */
  isSelf?(bearerType: MilestoneBearerType, bearerId: string): Promise<boolean>;
  /**
   * The user's own partnerships with no date yet, each asked about once.
   * Omitted: no partnership rows, and previously minted ones are pruned.
   */
  partnerships?: {
    undated(): Promise<UndatedPartnership[]>;
  };
  /**
   * Whether a milestone is about the user's own romantic partnership, however
   * borne. Gates `prompt.onlyOwnPartnership`; omitted, it is never minted.
   */
  isOwnPartnership?(
    bearerType: MilestoneBearerType,
    bearerId: string,
  ): Promise<boolean>;
  /** The **local civil** "today" reconcile runs against (see reminder-schedule). */
  today: CivilDate;
  /** Run the reconcile body atomically (the real driver's `transaction`). */
  transaction<T>(body: () => Promise<T>): Promise<T>;
  /** The first-run signals behind {@link ONBOARDING_STEPS}. Omitted: no
   *  onboarding rows. */
  onboarding?: {
    /** Whether the store holds a person or pet other than the self-person. */
    hasAnyEntityBesidesSelf(): Promise<boolean>;
    /** Whether the self-person has been picked yet. */
    hasSelf(): Promise<boolean>;
    /** Whether this store holds an account. */
    hasAccount(): Promise<boolean>;
    /** Whether any device, not necessarily this one, has a notification policy
     *  or has answered the OS prompt. */
    hasNotificationPolicy(): Promise<boolean>;
  };
  /**
   * The holiday-observance source. Omitted: no holiday rows, and every existing
   * one is pruned, so production must always supply it.
   */
  holidays?: {
    /** Candidates within the horizon, unlabelled: the possibly-encrypted
     *  label lookup waits until schedule and window filters narrow them. */
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
   * Unresolved duplicate pairs as `"lower:higher"` person-id keys. The nudge
   * only counts them, so no label lookup. Omitted: no duplicates row.
   */
  duplicates?: {
    pairKeys(): Promise<readonly string[]>;
  };
}

/** The entities a holiday observance can hang off. */
export type HolidayBearerType = "person" | "pet";

/** One of the user's partnerships with no date yet. `kind` is the missing date
 *  and the wording: a spouse lacks a wedding, a partner a first date. */
export interface UndatedPartnership {
  /** The relationship row's id — half of the nudge's identity. */
  relationshipId: string;
  /** The missing date's milestone kind: the other half, and the wording. */
  kind: "wedding" | "first-date";
  /** The partner's display label, for the question to name them. */
  partnerLabel: string;
  /** The partner, so the question can mention (and link to) them. */
  partnerType: HolidayBearerType;
  partnerId: string;
}

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

/** A reminder the engine wants to exist today. `dueDate` is null for the
 *  dateless families. */
interface DesiredReminder {
  id: string;
  title: string;
  dueDate: number | null;
  /**
   * When the row goes on display: `dueDate` less the action's **own**
   * `activeDays`, never the walk's {@link ActiveDaysOf}. Null when dateless.
   */
  activeFrom: number | null;
  /**
   * The occasion this row counts down to, which `dueDate` alone cannot recover;
   * it separates past due from belated (see {@link isWithinWindow}).
   */
  occurrenceDate: number | null;
  /** What the trailing countdown counts to when not `dueDate`: a `plan`
   *  question's occasion, not its decide-by date. */
  countdownDate?: number;
  /**
   * Display rank among dateless rows, 0 first, applied once at insert as a
   * `createdAt` back-off (undated rows sort newest first). Omitted ⇒ 0.
   */
  order?: number;
  /** Who the row is about and what it asks for, served through
   *  {@link listSystemReminderTargets}; absent on the dateless families. */
  target?: Omit<SystemReminderTarget, "id">;
  /** What the read re-renders the title from; absent on the dateless families,
   *  whose titles are fixed. */
  copy?: ReminderCopySource;
  /** Whether the occasion has passed (see {@link isWithinWindow}); read by
   *  {@link displayTitle}. */
  belated?: boolean;
}

/**
 * What a dated row's title is written from, carried unpersisted so the read can
 * write it again. The store keeps only the plain title.
 */
interface ReminderCopySource {
  action: ReminderAction;
  /** The bearer's label, mention-wrapped except for a relationship bearer. */
  subject: string;
  greeting: string;
  /** The greeting once the occasion has passed, or `null` where it has no
   *  belated form (see `belatedGreeting` in `@leapsake/schema`). */
  belatedGreeting: string | null;
  occasion: string;
  /** An `other` rule's free text, which is the whole of its copy. */
  label: string | null;
  /** Copy that replaces the template in both forms, for the self-directed
   *  branches only. Never part of the row's identity. */
  override: { plain: string; belated: string } | null;
}

/** Writes a dated reminder's title: the stored form (never belated, since the
 *  store must not hold a string that expires) and the displayed one. */
function renderTitle(copy: ReminderCopySource, belated: boolean): string {
  if (copy.override !== null)
    return belated ? copy.override.belated : copy.override.plain;
  const def = actionDefOf(copy.action);
  const body =
    verbOf(copy.action) === "other"
      ? // No template: an `other` is the user's own free text, so it names no
        // subject and has nothing to interpolate.
        reminderRuleLabel({ action: copy.action, label: copy.label })
      : def.template({
          subject: copy.subject,
          greeting:
            belated && copy.belatedGreeting !== null
              ? copy.belatedGreeting
              : copy.greeting,
          occasion: copy.occasion,
        });
  return `${def.icon ?? ""} ${body}`.trim();
}

/** The title the read shows in place of the stored one, or `null` when the
 *  stored one stands. Today that is only a passed occasion, worded belated. */
function derivedTitle(want: DesiredReminder): string | null {
  return want.copy !== undefined && want.belated === true
    ? renderTitle(want.copy, true)
    : null;
}

/**
 * Copy for a row about the user, whose occasion the third-person templates get
 * wrong: their own ("your own …") or shared ("… with @Violet").
 */
function copyOverrideOf(
  /** The occasion is the user's own (their person, or a relationship of theirs). */
  isSelf: boolean,
  /** ...and the subject the copy names is the user themself, not their partner. */
  subjectIsSelf: boolean,
  subject: string,
  action: ReminderAction,
  kind: MilestoneKind,
): { plain: string; belated: string } | null {
  if (verbOf(action) === "plan") {
    const occasion = kindDefs[kind].prompt?.occasion ?? kindDefs[kind].label;
    // Shared two ways: a gated kind borne by someone else (the gate has already
    // made it the user's), or anything borne by the user's own relationship.
    const shared =
      !subjectIsSelf &&
      (kindDefs[kind].prompt?.onlyOwnPartnership === true || isSelf);
    // Nothing differs from the template, so `actionDefs.plan` renders it.
    if (!subjectIsSelf && !shared) return null;
    const title = `${actionDefOf(action).icon ?? ""} ${planQuestion({
      subject,
      occasion,
      subjectIsSelf,
      shared,
    })}`.trim();
    // A passed occasion asks the same question: the answer shapes next year.
    return { plain: title, belated: title };
  }
  if (!isSelf) return null;
  // Which kinds have a self-directed wish is a per-kind fact (`selfWish`).
  if (verbOf(action) === "wish") return kindDefs[kind].selfWish ?? null;
  return null;
}

/** What a `system` reminder is about: its action and its bearer, keyed by id
 *  so a client can offer a CTA with no stored column. */
export interface SystemReminderTarget {
  id: string;
  action: ReminderAction;
  /** Includes relationships, whose prompts are answered like any other;
   *  consumers that need a person or pet filter for one. */
  bearerType: MilestoneBearerType;
  bearerId: string;
  /** The source milestone, for answering a `plan` prompt: the bearer can hold
   *  several occasions and the id is a one-way hash. Absent on holiday rows. */
  milestone?: { id: string; kind: MilestoneKind };
  /** The occasion's date, not the row's deadline, so a prompt can say when the
   *  occasion actually is. */
  occurrenceDate?: number | null;
}

/** The name a milestone reminder's id is derived from; the action key keeps a
 *  milestone's staggered reminders apart. */
function occurrenceName(
  milestoneId: string,
  occurrenceYear: number,
  actionKey: string,
): string {
  return `milestone:${milestoneId}:${occurrenceYear}:${actionKey}`;
}

/** Where an onboarding nudge deep-links; each client maps it to its own router
 *  (see {@link onboardingRouteOf}). */
export type OnboardingRoute =
  | "about-you"
  | "create-account"
  | "enable-notifications"
  | "import";

/** The raw first-run signals an onboarding step's condition is evaluated against. */
interface OnboardingSignals {
  /** A person or pet who isn't the user, so answering "about you" does not
   *  retire the import invitation. */
  hasEntitiesBesidesSelf: boolean;
  hasSelf: boolean;
  /** Whether this store holds an account at all. */
  hasAccount: boolean;
  /** Whether **any** device has been asked about notifications (see
   *  `enable-notifications`). */
  hasNotificationPolicy: boolean;
}

/** One first-run nudge, wanted while `applies` is true. Titles hold no `#`/`@`
 *  token, which would make the insert wrapper materialize tags. */
interface OnboardingStep {
  key: string;
  title: string;
  route: OnboardingRoute;
  applies(s: OnboardingSignals): boolean;
}

/**
 * The onboarding nudges, dateless rows retired by tombstone once `applies` goes
 * false, and never re-minted. Array order is display order on Home.
 */
const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    // Stands from day one, so an import lands in an encrypted store. The copy
    // promises access, not safety: a backup is what survives a lost device.
    key: "create-account",
    title: "🔐 Set up your login to protect the data on this device",
    route: "create-account",
    applies: (s) => !s.hasAccount,
  },
  {
    // Getting started means importing, not typing; manual entry is a tap on.
    key: "import-contacts",
    title: "📇 Import your contacts",
    route: "import",
    applies: (s) => !s.hasEntitiesBesidesSelf,
  },
  {
    // The self-person, which gifts start from. Needs no list to pick from.
    key: "about-you",
    title: "🙋 Tell us about yourself",
    route: "about-you",
    applies: (s) => !s.hasSelf,
  },
  {
    // Waits for someone to be notified about. Its condition is store-scoped,
    // its question per-device: see the README's notifications-nudge section.
    key: "enable-notifications",
    title: "🔔 Turn on notifications so reminders reach you",
    route: "enable-notifications",
    applies: (s) => s.hasEntitiesBesidesSelf && !s.hasNotificationPolicy,
  },
];

/** An onboarding step's id, in its own `onboarding:<key>` name-space. */
function onboardingId(key: string): string {
  return deterministicUuid(SYSTEM_REMINDER_NAMESPACE, `onboarding:${key}`);
}

/**
 * The duplicates nudge's id, keyed on the set of unresolved pairs so each new
 * set mints a fresh row and a tombstone silences only its own set.
 */
export function duplicatesReminderId(pairKeys: readonly string[]): string {
  return deterministicUuid(
    SYSTEM_REMINDER_NAMESPACE,
    `duplicates:${[...pairKeys].sort().join(",")}`,
  );
}

/** A partnership question's id. Carries the kind, since a dismissal is of one
 *  question; carries no year, so the dismissal is permanent. */
export function partnershipNudgeId(
  relationshipId: string,
  kind: UndatedPartnership["kind"],
): string {
  return deterministicUuid(
    SYSTEM_REMINDER_NAMESPACE,
    `partnership:${relationshipId}:${kind}`,
  );
}

/** The question, in its tense: an anniversary comes round ("when is"), a first
 *  date happened once ("when was"). */
function partnershipNudgeTitle(p: UndatedPartnership): string {
  const who = mentionToken(p.partnerLabel, p.partnerType, p.partnerId);
  return p.kind === "wedding"
    ? `\u{1F48D} When is your wedding anniversary with ${who}?`
    : `\u{1F49E} When was your first date with ${who}?`;
}

/** The Home copy for `n` unresolved pairs; no `#`/`@` tokens, as above. */
function duplicatesTitle(n: number): string {
  return n === 1
    ? "🔗 Two people might be the same — review"
    : `🔗 ${n} pairs of people might be the same — review`;
}

/** The name a holiday reminder's id is derived from. Keyed on the date, not the
 *  year: a lunisolar holiday can fall twice in one Gregorian year. */
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

/** Id ⇒ route: a client renders a deep-link CTA only for a match here. */
export const ONBOARDING_REMINDERS: readonly OnboardingReminder[] =
  ONBOARDING_STEPS.map((step) => ({
    id: onboardingId(step.key),
    route: step.route,
  }));

/** The CTA route for a reminder id, or `null` when it isn't an onboarding
 *  reminder. */
export function onboardingRouteOf(id: string): OnboardingRoute | null {
  return ONBOARDING_REMINDERS.find((r) => r.id === id)?.route ?? null;
}

/**
 * Where "remind me in `days` days" lands (the start of that civil day, as a due
 * date), or `null` when the row is done, due today, or would pass its due date.
 */
export function snoozeTargetOf(
  reminder: { completedAt: number | null; dueDate?: number | null },
  days: number,
  now: number,
): number | null {
  if (!Number.isInteger(days) || days < 1) return null;
  if (reminder.completedAt !== null) return null;
  const today = dueDateMs(todayCivil(now));
  const target = today + days * DAY_MS;
  const due = reminder.dueDate;
  if (due === null || due === undefined) return target;
  if (due <= today) return null;
  return target <= due ? target : null;
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
 * Both states display under one heading, *Belated* *(owner, 2026-09-11)*; the
 * distinction survives only to put what can still be saved first (see
 * `bucketReminders` in `@leapsake/view-models`).
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
 * A rule with the deadline and run-up it actually has for one occurrence —
 * which a late arrival can move away from the ones it was written with (see
 * `planTiming` and `effectiveOffsetDays` in `@leapsake/schema`).
 */
interface TimedRule {
  rule: ReminderRuleInput;
  /** Days before the occurrence this reminder comes due. */
  offsetDays: number;
  /** Days before its due date it goes on display. */
  runUp: number;
}

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
   * means *already on display*: a dateless nudge, or an undated user reminder. A
   * dated user reminder has no run-up and goes on display on its due date.
   */
  activeFrom: number | null;
  /** The occasion it counts down to, or null when it has none (user rows, nudges). */
  occurrenceDate: number | null;
  /**
   * What the row's trailing countdown should count to: the occasion for a `plan`
   * question, the due date for everything else, null when there is neither. See
   * {@link DesiredReminder.countdownDate}.
   */
  countdownDate: number | null;
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
    // What the row **says**, where that is not what it stores — see
    // {@link derivedTitle}. It overrides the stored string deliberately (the
    // store holds the plain form on purpose, and a `system` title is not
    // user-editable on either client, so there is nothing of the user's to
    // overwrite), but only where there is something derived to say: null leaves
    // the row exactly as it was read, which is every row until an occasion
    // passes.
    const derived = derivedTitle(want);
    const existing = await deps.reminders.getIncludingDeleted(want.id);
    if (existing !== undefined) {
      if (existing.deletedAt === null)
        rows.push({
          ...existing,
          title: derived ?? existing.title,
          ...factsOf(want, true),
        });
      continue;
    }
    rows.push({
      ...synthesize(want),
      title: derived ?? want.title,
      ...factsOf(want, false),
    });
  }

  const userRows = await deps.reminders.listWhere({
    where: "source = ?",
    params: ["user"],
  });
  return [
    ...rows,
    ...userRows.map((row) => ({
      ...row,
      // A dated reminder the user wrote goes on display **on its due date**
      // *(owner, 2026-09-11)*, waiting in the list's later sections until then
      // — one written for next month does not sit on Today for a month, and it
      // enters Today (and so notifies) on the day it names. Undated, it is on
      // display from the moment it is written.
      activeFrom: row.dueDate,
      occurrenceDate: null,
      countdownDate: row.dueDate,
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

/**
 * One reminder as the list sees it — the row a **detail** screen should read.
 *
 * Reading the stored row instead is the obvious thing and the wrong one: some of
 * what a reminder says is derived at this walk and not persisted (today the
 * belated wording, next the channel), so a detail screen reading past this seam
 * would disagree with the row that linked to it — on the very screen the reminder
 * is acted on. It also has no `activeFrom`/`occurrenceDate`, so it cannot say
 * which of the two ways of being missed it is in.
 *
 * Filtering the whole walk for one id is deliberate. A second, narrower path to
 * a single desired row would be a second implementation of the id derivation and
 * the window filter, and the day either changed the two would disagree silently
 * — the same argument `reminders.targets` is built on, and the same
 * cost: those two screens already pay for this walk twice over.
 *
 * `undefined` for an id the walk does not want — a dismissed row, or a `system`
 * one whose window has closed since the link was made. A caller with a screen to
 * fill should fall back to the stored row rather than showing nothing: outside
 * the window there is no derivation to apply, so the plain title is the whole
 * truth about it.
 */
export async function getReminderInWindow(
  deps: ReminderEngineDeps,
  id: string,
  windowDays: number = DISPLAY_WINDOW_DAYS,
): Promise<WindowedReminder | undefined> {
  const rows = await listRemindersInWindow(deps, windowDays);
  return rows.find((row) => row.id === id);
}

/** The window facts a desired row reports, once its store state is known. */
function factsOf(
  want: DesiredReminder,
  materialized: boolean,
): ReminderWindowFacts {
  return {
    activeFrom: want.activeFrom,
    occurrenceDate: want.occurrenceDate,
    countdownDate: want.countdownDate ?? want.dueDate,
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
    // **You can't be late for something the app has only just learned**
    // *(owner, 2026-09-11)*. The day it learned of this occasion — and of the
    // answer for it, a later day once the user has chosen — is what the
    // deadlines below are measured from: a question arriving inside its own lead
    // time is timed from it (`planTiming`), an errand chosen too late for its
    // own deadline slides (`effectiveOffsetDays`), and an occasion that had
    // already been is not reminded at all.
    const learned = todayCivil(m.createdAt);
    const answered =
      resolved.writtenAt === null ? learned : todayCivil(resolved.writtenAt);
    // **The engine never guesses.** An occasion with no rules of its own gets a
    // question rather than errands: one `plan` row, well ahead of everything the
    // question offers, asking what the user wants to do for it. Answering writes
    // ordinary rules, which flips the source to `stored`, which is what stops it
    // being asked again — unless the answer was a **partial** one, given too
    // late to be offered everything. That covers its own year only, and the
    // question comes back for the occurrences after it (`isPartialAnswer`).
    //
    // Synthesized as an ordinary rule rather than as a branch of its own, so it
    // inherits the window filter, the id derivation, the copy layer, the insert
    // /refresh/prune and the tombstone guard below with no second code path.
    // Whether a kind asks at all is `kindDefs[kind].prompt`; when it is due is
    // derived from what it offers and when the app learned of the occasion
    // (`planTiming`), never chosen.
    //
    // A kind may also narrow *who* it asks (`prompt.onlyOwnPartnership`, which
    // only `first-date` sets). The check is a port call, so it is made last and
    // only when a prompt would otherwise be minted — the common case never pays
    // for it.
    const prompt = kindDefs[m.kind].prompt;
    // Which occurrences may be asked about: every one while the occasion is
    // unanswered, only those after the one a partial answer covered, else none.
    let asksAfter: CivilDate | "always" | null = null;
    if (prompt !== undefined) {
      if (resolved.source === "kind-default") asksAfter = "always";
      else {
        const answeredFor = nextOccurrence(m.kind, m, answered);
        if (
          answeredFor !== null &&
          isPartialAnswer(
            m.kind,
            resolved.rules,
            daysUntil(answered, answeredFor),
          )
        )
          asksAfter = answeredFor;
      }
    }
    const asksAbout = (occ: CivilDate) =>
      asksAfter === "always" ||
      (asksAfter !== null && daysUntil(asksAfter, occ) > 0);
    const mayAsk =
      occurrences.some(asksAbout) &&
      (prompt?.onlyOwnPartnership !== true ||
        (deps.isOwnPartnership !== undefined &&
          (await deps.isOwnPartnership(m.bearerType, m.bearerId))));
    let subject: string | undefined;
    let bearerIsSelf = false;

    for (const occ of occurrences) {
      const learnedDaysOut = daysUntil(learned, occ);
      // An occasion that had already been when the app learned of it — a
      // birthday the day before an import — was never the user's to act on.
      if (learnedDaysOut < 0) continue;
      const days = daysUntil(deps.today, occ);

      // Each enabled rule, with the deadline and run-up it actually has for this
      // occurrence — not always the ones it was written with.
      const timed: TimedRule[] = [];
      // A question is asked only while it still has a choice to offer. One with
      // a single answer is not a question, so an ignored one retires once its
      // options run out rather than lingering to the occasion; the day-of wish
      // it leaves behind is already on the schedule.
      if (
        mayAsk &&
        asksAbout(occ) &&
        planOffers(m.kind, resolved.rules, days).length >= 2
      ) {
        const timing = planTiming(m.kind, resolved.rules, learnedDaysOut);
        timed.push({
          rule: {
            action: "plan",
            label: null,
            offsetDays: timing.dueOffsetDays,
            enabled: true,
          },
          offsetDays: timing.dueOffsetDays,
          // A late question is on display from the day the app learned of the
          // occasion, however far ahead of its due date that is.
          runUp: timing.late
            ? Math.max(
                ownActiveDays("plan"),
                learnedDaysOut - timing.dueOffsetDays,
              )
            : ownActiveDays("plan"),
        });
      }
      // The enabled set **at once**, never rule by rule. A late answer slides
      // deadlines, and sliding one rule past another authored to follow it is
      // what once had a card due in the post six days before it was bought —
      // see `effectiveOffsets`, which preserves the order the offsets encode.
      for (const { rule, offsetDays } of effectiveOffsets(
        resolved.rules.filter((r) => r.enabled),
        daysUntil(answered, occ),
      ))
        timed.push({ rule, offsetDays, runUp: ownActiveDays(rule.action) });
      // The rules that actually want a reminder for this occurrence today: alive
      // on the walk's window, or on the row's own run-up where that is wider — a
      // late question's can be, and a row this walk would materialize must never
      // fall outside the preview walk that feeds the screen.
      const rules = timed.filter((t) =>
        isWithinWindow(
          days,
          t.offsetDays,
          Math.max(activeDaysOf(t.rule.action), t.runUp),
        ),
      );
      if (rules.length === 0) continue;

      if (subject === undefined) {
        const label = await deps.resolveLabel(m.bearerType, m.bearerId);
        if (label === null) break; // bearer gone — nothing to name the reminder
        // Wrap the subject in an inline mention token so the name links to the
        // person/pet page (the reminder text is the single source of truth for the
        // mention; core re-derives the backlink from it). A relationship bearer
        // has no single entity to point at, so it stays **plain text** — its label
        // is either both endpoints ("Harry & Tilly", two entities, and a token names
        // one) or, for a relationship you are in, the other end, whose id this
        // loop does not have. Losing the backlink is the accepted cost of the row
        // existing at all; before 2026-09-05 a relationship never reached here,
        // because its label resolved to null and the milestone was skipped.
        subject =
          m.bearerType === "relationship"
            ? label
            : mentionToken(label, m.bearerType, m.bearerId);
        // Is this milestone about *you*? A single copy-layer branch (below) flips
        // the birthday wish and the prompt to self-directed rather than filtering
        // your own occasions out — you are not excluded. A relationship you are
        // one end of counts, which is what makes your own wedding anniversary ask
        // "your own", so every bearer type is offered to the port rather than
        // only `person`.
        bearerIsSelf =
          deps.isSelf !== undefined
            ? await deps.isSelf(m.bearerType, m.bearerId)
            : false;
      }

      for (const { rule, offsetDays, runUp } of rules) {
        const id = deterministicUuid(
          SYSTEM_REMINDER_NAMESPACE,
          occurrenceName(m.id, occ.year, actionKeyOf(rule)),
        );
        // The action's copy carries the (mention-wrapped) subject — "Wish @Violet
        // a happy birthday", "Get @Violet a gift" — unless the bearer is you, in
        // which case {@link selfOverrideOf} replaces it. Assembled rather than
        // rendered on the spot because the read renders it a second time: see
        // {@link ReminderCopySource}.
        const copy: ReminderCopySource = {
          action: rule.action,
          subject,
          greeting: kindDefs[m.kind].greeting,
          // Absent on the kinds with no natural belated form, which then keep
          // the plain greeting rather than being handed a spliced one.
          belatedGreeting: kindDefs[m.kind].belatedGreeting ?? null,
          // Only `plan` reads this today. Falling back to the kind's own label
          // keeps the context total for the kinds that never prompt, rather
          // than making the field optional — see the warning on
          // `ReminderCopyContext`.
          occasion:
            kindDefs[m.kind].prompt?.occasion ??
            kindDefs[m.kind].label.toLowerCase(),
          label: rule.label ?? null,
          override: copyOverrideOf(
            bearerIsSelf,
            // The subject is *you* only when the bearer is you personally. A
            // relationship of yours is equally "your own", but the name it
            // resolves to is your partner's — so it takes the shared wording,
            // which is the better read anyway.
            bearerIsSelf && m.bearerType === "person",
            subject,
            rule.action,
            m.kind,
          ),
        };
        // Due `offsetDays` before the occurrence (day-of when 0) — the deadline
        // this occurrence actually has, which may not be the rule's own; stored
        // as UTC midnight of that civil day, so plain integer subtraction is
        // exact. A belated row's due date is simply in the past, which is honest.
        const dueDate = dueDateMs(occ) - offsetDays * DAY_MS;
        desired.set(id, {
          id,
          // The **plain** form, always: what is stored must not be a sentence
          // that expires overnight. The belated wording is put on at the read.
          title: renderTitle(copy, false),
          copy,
          belated: days < 0,
          dueDate,
          activeFrom: dueDate - runUp * DAY_MS,
          occurrenceDate: dueDateMs(occ),
          // A question counts down to the occasion, not to when to decide by.
          ...(verbOf(rule.action) === "plan"
            ? { countdownDate: dueDateMs(occ) }
            : {}),
          target: {
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
          const copy: ReminderCopySource = {
            action: rule.action,
            subject,
            greeting: candidate.greeting,
            // ⚠️ Holidays carry no belated greeting, so a passed one keeps its
            // plain wording. A holiday's greeting is a **stored column** seeded
            // from the catalog, not a registry constant, so a second phrase
            // there is a migration — and "a belated Merry Christmas" is not yet
            // worth one. The plumbing is ready for it the day it is: this is the
            // only line that changes.
            belatedGreeting: null,
            occasion: candidate.occasion,
            label: rule.label ?? null,
            // An observance is borne by a (person, holiday) pair, so there is no
            // self-directed case to override: your own Christmas is not an
            // occasion this engine reminds you about.
            override: null,
          };
          const dueDate = dueDateMs(occ) - rule.offsetDays * DAY_MS;
          desired.set(id, {
            id,
            title: renderTitle(copy, false),
            copy,
            belated: days < 0,
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
  // "don't re-nag" semantic. Putting a step off never retires it. Only when the
  // caller injects the port (clients do; engine unit tests may not) — otherwise
  // no onboarding rows join the set.
  if (deps.onboarding !== undefined) {
    const signals: OnboardingSignals = {
      hasEntitiesBesidesSelf: await deps.onboarding.hasAnyEntityBesidesSelf(),
      hasSelf: await deps.onboarding.hasSelf(),
      hasAccount: await deps.onboarding.hasAccount(),
      hasNotificationPolicy: await deps.onboarding.hasNotificationPolicy(),
    };
    for (const [index, step] of ONBOARDING_STEPS.entries()) {
      if (!step.applies(signals)) continue;
      const id = onboardingId(step.key);
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

  // The user's own partnerships with no date on them — the fifth family, and the
  // only one that asks *for* something rather than reminding of it. Ranked last:
  // it is the least urgent row on the screen by construction, since nothing is
  // coming up. Retires by the ordinary prune the moment the date exists, or by
  // the user's own *don't ask again*.
  if (deps.partnerships !== undefined) {
    for (const [index, p] of (await deps.partnerships.undated()).entries()) {
      const id = partnershipNudgeId(p.relationshipId, p.kind);
      desired.set(id, {
        id,
        title: partnershipNudgeTitle(p),
        dueDate: null,
        activeFrom: null,
        occurrenceDate: null,
        order: ONBOARDING_STEPS.length + 1 + index,
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
