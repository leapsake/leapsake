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
 * Whether a rule's reminder is alive: on display `activeDays` before its due
 * date, until `BELATED_DAYS` after its **occurrence**, not its due date.
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

/** How many days before its due date an action's reminder goes on display:
 *  its own run-up for rows, one uniform horizon for the wider reads. */
type ActiveDaysOf = (action: ReminderAction) => number;

/** The materialization window: every action's own declared run-up. */
const ownActiveDays: ActiveDaysOf = (action) => actionDefOf(action).activeDays;

/** A rule with the deadline and run-up it has for one occurrence, which a late
 *  arrival can move (see `planTiming` in `@leapsake/schema`). */
interface TimedRule {
  rule: ReminderRuleInput;
  /** Days before the occurrence this reminder comes due. */
  offsetDays: number;
  /** Days before its due date it goes on display. */
  runUp: number;
}

/**
 * Reconcile the store's `system` reminders to what should exist today, and
 * return the counts. Idempotent; never resurrects a tombstone.
 */
export async function regenerateSystemReminders(
  deps: ReminderEngineDeps,
): Promise<{ created: number; updated: number; removed: number }> {
  return reconcile(deps, await computeDesired(deps, ownActiveDays));
}

/** What each `system` reminder that should exist today is about, from the same
 *  walk {@link regenerateSystemReminders} reconciles against. */
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

/** How far ahead {@link listNotifiableReminders} looks: every tracked occasion
 *  recurs yearly, so a year schedules each exactly once. */
export const NOTIFICATION_WINDOW_DAYS = 365;

/** How far ahead the reminder list looks. Must stay at or above
 *  `MAX_ACTIVE_DAYS`, or rows already minted drop out of the list. */
export const DISPLAY_WINDOW_DAYS = 30;

/** What the engine knows about a row's timing that the stored row cannot say;
 *  derived on every read, never persisted. */
export interface ReminderWindowFacts {
  /** When the row goes on display; null means already on display. A dated user
   *  reminder goes on display on its due date. */
  activeFrom: number | null;
  /** The occasion it counts down to, or null when it has none (user rows, nudges). */
  occurrenceDate: number | null;
  /** What the trailing countdown counts to (see
   *  {@link DesiredReminder.countdownDate}); null when there is nothing. */
  countdownDate: number | null;
  /** `false` marks a preview with no row yet: no state, and nothing to edit,
   *  remove or join. */
  materialized: boolean;
}

/** A reminder paired with what the engine knows about its timing. */
export type WindowedReminder = Reminder & ReminderWindowFacts;

/**
 * Every reminder within `windowDays`, row or not: live rows as stored, absent
 * ones synthesized under the id they will be minted with, tombstones skipped.
 */
export async function listRemindersInWindow(
  deps: ReminderEngineDeps,
  windowDays: number,
): Promise<WindowedReminder[]> {
  // One uniform horizon; each row still reports its own `activeFrom`.
  const desired = await computeDesired(deps, () => windowDays);

  const rows: WindowedReminder[] = [];
  for (const want of desired.values()) {
    // A `system` title is not user-editable, so overriding it loses nothing.
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
      // A dated user reminder shows from its due date; an undated one at once.
      activeFrom: row.dueDate,
      occurrenceDate: null,
      countdownDate: row.dueDate,
      materialized: true,
    })),
  ];
}

/** Every reminder a device should consider notifying about: a year of them,
 *  most not yet rows. */
export function listNotifiableReminders(
  deps: ReminderEngineDeps,
): Promise<WindowedReminder[]> {
  return listRemindersInWindow(deps, NOTIFICATION_WINDOW_DAYS);
}

/**
 * One reminder as the list sees it, for a detail screen. `undefined` outside
 * the walk; the caller should then fall back to the stored row.
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
 * Mint a previewed reminder so it can be ticked early; true when a live row now
 * exists. The next reconcile prunes it, retiring the errand for the year.
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

/** Mint the row for a desired reminder, shared by {@link reconcile} and
 *  {@link materializeReminder}. */
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
    // Snoozing is a user act, never a reconcile one.
    snoozedUntil: null,
    source: "system",
    // The display-rank back-off; zero for dated rows.
    createdAt: now - (want.order ?? 0),
    updatedAt: now,
    deletedAt: null,
  });
}

/** A desired row as it would be minted, stamped as never persisted. */
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

  // Keyed by deterministic id, so duplicate identities collapse.
  const desired = new Map<string, DesiredReminder>();
  for (const m of milestones) {
    // The previous occurrence too, or a missed one would vanish overnight.
    // `recentOccurrence` is strictly before today, so none is seen twice.
    const occurrences = [
      recentOccurrence(m.kind, m, deps.today, BELATED_DAYS),
      nextOccurrence(m.kind, m, deps.today),
    ].filter((occ) => occ !== null);
    if (occurrences.length === 0) continue;

    // The schedule before the label, so the possibly-encrypted label lookup is
    // skipped when nothing is in window.
    const resolved = await deps.resolveSchedule(m);
    // Deadlines run from when the app learned of the occasion and its answer:
    // you can't be late for something it has only just learned.
    const learned = todayCivil(m.createdAt);
    const answered =
      resolved.writtenAt === null ? learned : todayCivil(resolved.writtenAt);
    // An occasion with no rules of its own gets a `plan` question, made a rule
    // so it shares the window, id, copy and prune paths below.
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
    // The ownership port is called last, so the common case never pays for it.
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
      // Asked only while it still offers a choice; the day-of wish it leaves
      // behind is already on the schedule.
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
      // The enabled set at once: a late answer slides deadlines, and
      // `effectiveOffsets` keeps the order the offsets encode.
      for (const { rule, offsetDays } of effectiveOffsets(
        resolved.rules.filter((r) => r.enabled),
        daysUntil(answered, occ),
      ))
        timed.push({ rule, offsetDays, runUp: ownActiveDays(rule.action) });
      // Alive on the walk's window or the row's own wider run-up, so a row this
      // walk would mint never falls outside the preview walk.
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
        // A mention token links the name. A relationship has no one entity to
        // point at, so its label stays plain text.
        subject =
          m.bearerType === "relationship"
            ? label
            : mentionToken(label, m.bearerType, m.bearerId);
        // Every bearer type is asked, so your own relationship counts as yours.
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
        // Assembled, not rendered: the read renders it a second time.
        const copy: ReminderCopySource = {
          action: rule.action,
          subject,
          greeting: kindDefs[m.kind].greeting,
          // Absent on the kinds with no natural belated form, which then keep
          // the plain greeting rather than being handed a spliced one.
          belatedGreeting: kindDefs[m.kind].belatedGreeting ?? null,
          // Only `plan` reads this; the kind's label keeps it total.
          occasion:
            kindDefs[m.kind].prompt?.occasion ??
            kindDefs[m.kind].label.toLowerCase(),
          label: rule.label ?? null,
          override: copyOverrideOf(
            bearerIsSelf,
            // Only you personally: your relationship names your partner, so it
            // takes the shared wording.
            bearerIsSelf && m.bearerType === "person",
            subject,
            rule.action,
            m.kind,
          ),
        };
        // A belated row's due date is simply in the past.
        const dueDate = dueDateMs(occ) - offsetDays * DAY_MS;
        desired.set(id, {
          id,
          // The plain form: the store must not hold a sentence that expires.
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

  // Holiday observances, on the same rails. No try/catch: a swallowed failure
  // would prune every holiday row; the resolver answers `[]` instead.
  if (deps.holidays !== undefined) {
    for (const candidate of await deps.holidays.listCandidates()) {
      let label: string | undefined;
      for (const occ of candidate.occurrences) {
        // No `days < 0` guard: isWithinWindow keeps the belated tail open.
        const days = daysUntil(deps.today, occ);

        const rules = (await deps.holidays.resolveSchedule(candidate)).filter(
          (r) =>
            r.enabled &&
            isWithinWindow(days, r.offsetDays, activeDaysOf(r.action)),
        );
        if (rules.length === 0) continue;

        // At most once per candidate, and only once something is due: the
        // candidates are people × holidays.
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
            // No belated greeting yet: a holiday's greeting is a stored column.
            belatedGreeting: null,
            occasion: candidate.occasion,
            label: rule.label ?? null,
            // No self-directed case: your own Christmas is not reminded.
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

  // Onboarding nudges: dateless rows on the same rails, retired by the prune
  // once their condition is met.
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
      // `index` is the display rank. Dateless, so already on display.
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

  // Unresolved duplicate pairs as one row, ranked below onboarding so a new
  // user finishes setting up first.
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

  // Undated partnerships, ranked last since nothing is coming up. The prune
  // retires one once its date exists.
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
      // Refresh a live row only on drift, keeping its id and completion, so a
      // steady-state reconcile writes nothing.
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
