import {
  type OnboardingRoute,
  onboardingRouteOf,
  snoozeTargetOf,
} from "@leapsake/reminders";
import {
  type GiftPartyType,
  type MilestoneKind,
  type ReminderRuleInput,
  civilFromDueMs,
  compareReminderDue,
  daysUntil,
  todayCivil,
} from "@leapsake/schema";

/** What the reminders list partitions and orders on. `ReminderWithTags` satisfies it. */
export interface ReminderStanding {
  completedAt: number | null;
  dueDate: number | null;
  snoozedUntil: number | null;
  createdAt: number;
}

/**
 * The reminders list, split the way both clients show it: **open** reminders
 * lead, soonest due first with undated ones sinking below (see
 * {@link compareReminderDue}); **completed** ones follow — a disclosure on
 * desktop, struck through at the foot of the list on mobile — keeping the repo's
 * newest-first order, because a done reminder's due date has stopped mattering.
 *
 * **Snoozed** reminders are held back until their clock passes. Precedence:
 * completion wins over snooze, so a reminder you put off and then finished is
 * `done`, not pending. A row is snoozed until the civil day in `snoozedUntil`
 * begins — compared in whole days, like every other date here, so it is back from
 * the viewer's local midnight on that day. `dueDate` is untouched by any of this: an un-snoozed
 * row sorts among the open ones exactly as it always did, because the hide is a
 * filter and never a re-ranking.
 *
 * **Why the hide lives here and not in the reminder engine.** A deferral
 * implemented as "stop desiring the row" would be pruned to a tombstone by
 * `reconcile`, and a tombstoned id is never resurrected — so "not now" would
 * silently mean *never*. Display-level is the only place a deferral can be
 * temporary. Do not move it.
 *
 * The `snoozed` bucket is returned rather than dropped so that "should a snoozed
 * reminder still be findable by search?" stays an open question instead of one
 * foreclosed by this function. Nothing displays it yet, so it keeps the caller's
 * order — whoever gives it a surface picks a meaningful one.
 *
 * `now` is a parameter so the split is deterministic and testable; the default is
 * caller convenience.
 */
export function partitionReminders<R extends ReminderStanding>(
  reminders: readonly R[],
  now: number = Date.now(),
): { open: R[]; done: R[]; snoozed: R[] } {
  const active = reminders.filter((r) => r.completedAt === null);
  const today = todayCivil(now);
  const isSnoozed = (r: R) =>
    r.snoozedUntil !== null &&
    daysUntil(today, civilFromDueMs(r.snoozedUntil)) > 0;

  return {
    open: active.filter((r) => !isSnoozed(r)).sort(compareReminderDue),
    done: reminders.filter((r) => r.completedAt !== null),
    snoozed: active.filter(isSnoozed),
  };
}

/**
 * What the reminders list buckets on: a row's standing, plus the two dates only
 * the engine can supply. Core's `listInWindow` rows satisfy it; both extras are
 * optional so a plain `ReminderWithTags` still does, and falls into the
 * bucketing a dateless row gets.
 */
export interface ReminderTiming extends ReminderStanding {
  /**
   * When this row goes on display. Null (or absent) means **already on
   * display** — a dateless nudge, or an undated user reminder, which is on
   * display from the moment it is written. A dated user reminder goes on display
   * on its due date.
   */
  activeFrom?: number | null;
  /**
   * The occasion this row counts down to, if it has one. It is what puts an
   * overdue row that can still be saved ahead of one whose occasion has gone;
   * see {@link bucketReminders}.
   */
  occurrenceDate?: number | null;
  /**
   * The date the row's countdown shows, where that is not `dueDate` — a `plan`
   * question shows the occasion it asks about. It is what the list sorts on, so
   * the numbers on screen read in order; see {@link bucketReminders}.
   */
  countdownDate?: number | null;
}

/** Which part of the reminders list a row belongs in. */
export type ReminderBucket = "belated" | "today" | "next7" | "later";

/** Every section of the list, the completed one included — what a row's
 *  countdown is worded for ({@link reminderCountdownOf}). */
export type ReminderSection = ReminderBucket | "done";

/** How far ahead *Next 7 days* reaches; a row entering Today later than this is
 *  in *Later*. */
export const NEXT_DAYS = 7;

/**
 * The day a row enters Today: the later of the day it goes on display
 * (`activeFrom`) and the day its snooze ends. `null` for a row with neither — on
 * display from the start, and never put off.
 */
export function landingDayOf(reminder: ReminderTiming): number | null {
  const shown = reminder.activeFrom ?? null;
  const back = reminder.snoozedUntil;
  if (shown === null) return back;
  if (back === null) return shown;
  return Math.max(shown, back);
}

/**
 * The reminders list, split the way the screen shows it — the display half of
 * what the engine's window already knows, and a refinement of
 * {@link partitionReminders}, which it calls first and whose `done` bucket it
 * passes straight through.
 *
 * - **belated** — everything overdue, in two kinds under one heading *(owner,
 *   2026-09-11)*: first a deadline that blew while the occasion is still ahead
 *   (the card missed its post date, but the birthday is Tuesday, so pay for
 *   express), because acting on it still has the most value of anything on the
 *   screen; then the occasions that have gone, where only acknowledgment is
 *   left. Each row's countdown already says which it is, so a second heading
 *   would only ask the reader to learn the difference before reading a row.
 * - **today** — everything on display and not overdue: every dateless row
 *   first, then the rest by due date, however far off that is.
 * - **next7** / **later** — what is not on Today yet: rows whose display has
 *   not started, and rows put off. Each goes by the day it next enters Today
 *   ({@link landingDayOf}) — within {@link NEXT_DAYS} days is *next7*, beyond is
 *   *later*.
 *
 * ⚠️ **Today holds everything that can be done now** *(owner, 2026-09-11)*. It
 * used to stop at what was due today, with a month-long gift errand parked in an
 * *available* section below that deliberately did not count — so the day could
 * be finished, but never earned. The errand is on Today now, known by its "Due
 * in N days" rather than by a divider, and it leaves the day by being done,
 * dismissed, or put off with "Remind me in…". `owed` — belated plus today — is
 * therefore everything actionable, and reaching zero is a real finish line.
 *
 * **Dateless rows are owed, and lead** *(owner, 2026-09-04, 2026-09-11)*. An
 * onboarding nudge, the duplicates nudge and an undated user reminder have no due
 * date to sort on; each has been owed since it appeared, and the passing of time
 * will never move it up the list — so they go first, and a busy morning cannot
 * bury the getting-started steps.
 *
 * ⚠️ **What can still be saved leads belated.** The two kinds of overdue differ
 * in what can be done, and only the occurrence tells them apart: an overdue user
 * reminder has none — nothing has *passed* — so it sorts with the salvageable
 * rows. That is why `occurrenceDate` has to travel with the row: `dueDate` alone
 * cannot recover it, the action not being a column.
 *
 * **Each section is ordered by the date that moves a row out of it** *(owner,
 * 2026-09-11)*: Today by due date, the day a row turns belated; the later
 * sections by the day it enters Today. Belated has nowhere further to go, so it
 * sorts on the date each row shows (`countdownDate`). The countdown a row shows
 * in each section is that same date — {@link reminderCountdownOf} — so the
 * numbers on screen read in order.
 *
 * *Later* is not everything beyond a week: a `system` row only exists inside the
 * engine's display window, while a reminder the user wrote can be months out.
 *
 * Every comparison is whole civil days ({@link daysUntil}), never elapsed
 * milliseconds, so the buckets flip at the viewer's local midnight exactly as
 * the engine's own window does. `now` is a parameter for the same reason
 * {@link partitionReminders} takes one.
 */
export function bucketReminders<R extends ReminderTiming>(
  reminders: readonly R[],
  now: number = Date.now(),
): {
  belated: R[];
  today: R[];
  next7: R[];
  later: R[];
  done: R[];
  /** belated + today — everything that can be done now, and what "done for
   *  the day" measures. */
  owed: number;
} {
  const { open, done, snoozed } = partitionReminders(reminders, now);
  const todayCivilDate = todayCivil(now);
  const daysTo = (ms: number) => daysUntil(todayCivilDate, civilFromDueMs(ms));

  // Belated and today are each built from two halves, so that the half that
  // leads is decided here rather than by whatever order the rows arrived in.
  const salvageable: R[] = [];
  const gone: R[] = [];
  const dateless: R[] = [];
  const dated: R[] = [];
  const next7: R[] = [];
  const later: R[] = [];

  // Snoozed rows are not on Today, so they join the later sections by the day
  // they come back.
  for (const reminder of [...open, ...snoozed]) {
    const lands = landingDayOf(reminder);
    const untilLands = lands === null ? 0 : daysTo(lands);
    if (untilLands > 0) {
      (untilLands <= NEXT_DAYS ? next7 : later).push(reminder);
      continue;
    }
    const { dueDate, occurrenceDate } = reminder;
    if (dueDate === null) dateless.push(reminder);
    else if (daysTo(dueDate) >= 0) dated.push(reminder);
    else if (
      occurrenceDate !== null &&
      occurrenceDate !== undefined &&
      daysTo(occurrenceDate) < 0
    )
      gone.push(reminder);
    else salvageable.push(reminder);
  }

  // Every sort is stable, so rows on the same day keep the order they arrived in.
  const shown = (r: R) => r.countdownDate ?? r.dueDate ?? 0;
  const byShown = (a: R, b: R) => shown(a) - shown(b);
  const byLanding = (a: R, b: R) =>
    (landingDayOf(a) ?? 0) - (landingDayOf(b) ?? 0);
  salvageable.sort(byShown);
  gone.sort(byShown);
  dated.sort((a, b) => (a.dueDate ?? 0) - (b.dueDate ?? 0));
  next7.sort(byLanding);
  later.sort(byLanding);

  const belated = [...salvageable, ...gone];
  const today = [...dateless, ...dated];
  return {
    belated,
    today,
    next7,
    later,
    done,
    owed: belated.length + today.length,
  };
}

/** What a row's trailing countdown counts to, and in which words — see
 *  {@link reminderCountdownOf}. */
export type ReminderCountdown =
  | { kind: "due"; date: number }
  | { kind: "back"; date: number }
  | { kind: "coming"; date: number }
  | { kind: "shown"; date: number };

/**
 * What a row's trailing countdown says in the section it is in: the date that
 * section sorts it by, and which words to put that date in. The words are the
 * clients' (`formatDueCountdown`, `formatBackIn`, `formatComingIn` and
 * `formatDueIn` in `@leapsake/schema`); the date is chosen here, once for both,
 * so the number a row shows and its place in the list cannot disagree.
 *
 * - **today** — its deadline, as *due*: "Due in 5 days". A question shows its
 *   deadline too, not its occasion *(owner, 2026-09-11)* — *due* is what keeps
 *   it from reading as the birthday, which its detail screen still names.
 * - **next7 / later** — the day it enters Today: *back* for a row that was put
 *   off, plain for one whose display has not started.
 * - **belated / done** — the date the row shows, as it always has.
 *
 * `null` when there is nothing to count to — a dateless row.
 */
export function reminderCountdownOf(
  reminder: ReminderTiming,
  section: ReminderSection,
): ReminderCountdown | null {
  if (section === "today")
    return reminder.dueDate === null
      ? null
      : { kind: "due", date: reminder.dueDate };
  if (section === "next7" || section === "later") {
    const lands = landingDayOf(reminder);
    if (lands === null) return null;
    return {
      kind: lands === reminder.snoozedUntil ? "back" : "coming",
      date: lands,
    };
  }
  const shown = reminder.countdownDate ?? reminder.dueDate;
  return shown === null ? null : { kind: "shown", date: shown };
}

/** The person or pet a `🎁 gift` reminder is about. Core's `GiftReminderTarget` satisfies it. */
export interface GiftReminderSubject {
  recipientType: GiftPartyType;
  recipientId: string;
}

/**
 * The person a `🎉 wish` reminder is about, and whether there is any way to
 * reach them. Core's `ContactReminderTarget` satisfies it.
 *
 * A **person**, never a pet: `contactOwnerTypeSchema` is person/household, so a
 * pet cannot own a contact method and asking the user to add one for Jimmy is
 * asking for something the app has nowhere to put.
 */
export interface ContactReminderSubject {
  personId: string;
  /** Whether they have any method worth offering — postal excluded upstream. */
  hasMethods: boolean;
}

/** What a `🗓 plan` prompt is asking about. Core's `PlanReminderTarget` satisfies it. */
export interface PlanReminderSubject {
  milestoneId: string;
  /** Named for what it is, not `kind`: {@link ReminderCta} already discriminates
   *  on that, and a spread would silently overwrite it. */
  milestoneKind: MilestoneKind;
  /** Every action offered, `enabled` carrying which arrive pre-ticked. */
  offers: ReminderRuleInput[];
}

/**
 * Where a reminder row's call to action leads — the *decision*, not the route.
 * Each client maps this to its own router path and its own copy, since the two
 * routers spell the same screen differently and the label is user-visible text.
 */
/**
 * A partnership question's subject: which relationship is missing a date, and
 * which date it is missing.
 *
 * `milestoneKind` travels rather than being re-derived from the role, so the
 * client opens the milestone form already on the right kind. Asking "when is
 * your anniversary?" and then landing on a blank kind picker is the same failure
 * a `plan` prompt avoids by carrying its offer set: the question is only worth
 * asking if answering it is cheap.
 */
export interface PartnershipReminderSubject {
  relationshipId: string;
  milestoneKind: "wedding" | "first-date";
  /** The partner, for a client that would rather route via their page. */
  partnerId: string;
}

/**
 * A couple's occasion held by one person, with nobody on the other side yet:
 * the milestone, its kind, and the person it is stored on. `isSelf` changes
 * only the wording: "who is your spouse?" rather than "add who it's with".
 */
export interface LinkPartnerReminderSubject {
  milestoneId: string;
  milestoneKind: "wedding" | "first-date";
  personId: string;
  isSelf: boolean;
}

export type ReminderCta =
  | { kind: "onboarding"; route: OnboardingRoute }
  | { kind: "duplicates" }
  | ({ kind: "plan" } & PlanReminderSubject)
  | ({
      kind: "gift";
      action: "see-gifts" | "record-giving";
    } & GiftReminderSubject)
  | { kind: "contact"; personId: string }
  | ({ kind: "partnership" } & PartnershipReminderSubject)
  | ({ kind: "link-partner" } & LinkPartnerReminderSubject);

/**
 * The call to action a reminder row offers, or `null` for the ordinary reminders
 * (user-written, birthday, milestone, holiday) that just sit there and get done.
 *
 * Four kinds, in precedence order — no reminder is ever eligible for two, so the
 * order only fixes the shape of the check:
 *
 * 1. an **onboarding** nudge, identified by its well-known id
 *    ({@link onboardingRouteOf}) and deep-linking to the step it asks for;
 * 2. the **duplicates** nudge, whose id is content-addressed on the outstanding
 *    pair set and so is passed in by the caller rather than looked up;
 * 3. a **`🗓 plan`** prompt, which is a *question* rather than an errand: its
 *    call to action is answering it, and it carries the offer set so a client
 *    can write the answer without a second read. ⚠️ It is the one CTA whose
 *    point is that the row is **cheap to answer** — the increment trades several
 *    passive rows for one that asks you something, and that only pays off if the
 *    common answer costs less than ignoring the old rows did. A client that
 *    renders it as nothing but a link to a settings screen has lost the trade;
 *    {@link ReminderRowAction} carries the one-tap answer for that reason.
 * 4. a **`🎁 gift`** reminder, whose target flips on completion — the loop the
 *    reminder itself opens. *Open:* the recipient's own page, whose Gifts section
 *    lists what's already suggested for them (and what they've been given, so you
 *    don't repeat yourself). *Done:* logging what you actually gave.
 * 5. a **`🎉 wish`** for someone there is **no way to reach** — the collect
 *    prompt. "Wish Violet a happy birthday" with no phone, no email and no handle
 *    is a reminder the app cannot help you act on, so it offers to fix that.
 *
 * ⚠️ The fifth is the one with a rule about what it must *not* become. It is
 * offered only where `hasMethods` is false, so a person you can already reach
 * gets buttons instead and is never asked for more; and it is *a nudge, never a
 * wall* — the reminder stays completable with no contact method at all, which is
 * the whole difference between offering help and demanding setup. Where a person
 * does have methods there is no CTA here at all: the affordances are the client's
 * to render from the same read, because "what can I do right now" is a list of
 * buttons rather than a single decision.
 *
 * Completion stays the plain Done action rather than growing a modal: nothing
 * else in reminders interrupts that path, and a link the user can take or ignore
 * respects a "done" that meant "handled, nothing to log".
 */
export function reminderCtaOf(
  reminder: { id: string; completedAt: number | null },
  context: {
    /** Set when this is a `🎁 gift` reminder — who it's about. */
    giftTarget?: GiftReminderSubject;
    /** Set when this row is today's duplicates nudge. */
    isDuplicatesNudge?: boolean;
    /** Set when this is a `🗓 plan` prompt — what it is asking about. */
    planTarget?: PlanReminderSubject;
    /** Set when this is a `🎉 wish` about a person — who, and whether they are
     *  reachable. Absent for a pet, which can own no contact method. */
    contactTarget?: ContactReminderSubject;
    /** Set when this row is a partnership question — see
     *  {@link PartnershipReminderSubject}. */
    partnershipTarget?: PartnershipReminderSubject;
    /** Set when this row is about a wedding with nobody on the other side of it
     *  — see {@link LinkPartnerReminderSubject}. */
    linkPartnerTarget?: LinkPartnerReminderSubject;
  } = {},
): ReminderCta | null {
  const onboardingRoute = onboardingRouteOf(reminder.id);
  if (onboardingRoute !== null)
    return { kind: "onboarding", route: onboardingRoute };
  if (context.isDuplicatesNudge === true) return { kind: "duplicates" };
  if (context.planTarget !== undefined)
    return { kind: "plan", ...context.planTarget };
  if (context.giftTarget !== undefined) {
    return {
      kind: "gift",
      action: reminder.completedAt !== null ? "record-giving" : "see-gifts",
      recipientType: context.giftTarget.recipientType,
      recipientId: context.giftTarget.recipientId,
    };
  }
  if (context.partnershipTarget !== undefined)
    return { kind: "partnership", ...context.partnershipTarget };
  // Ahead of `contact` below: who your anniversary is *with* is closer to the
  // point of the row than how to reach them, and on a wedding of your own the
  // contact CTA would be offering you a way to reach yourself.
  if (context.linkPartnerTarget !== undefined)
    return { kind: "link-partner", ...context.linkPartnerTarget };
  // Last, and only for the unreachable case: a person you *can* reach needs no
  // call to action, because the client is rendering their methods as buttons.
  if (context.contactTarget !== undefined && !context.contactTarget.hasMethods)
    return { kind: "contact", personId: context.contactTarget.personId };
  return null;
}

/**
 * One thing a reminder row offers the user — the *decision*, never the label.
 *
 * The `cta` entry wraps {@link ReminderCta} whole rather than flattening its
 * three kinds in beside `snooze` and `dismiss`: each client already has a
 * function mapping a CTA to its own path and copy, and a flattened union would
 * make every one of those need a type guard to get a `ReminderCta` back out.
 *
 * `snooze` carries a day count, not a date: the write turns it into the day it
 * lands on by the same rule that decided it could be offered, so nobody derives
 * the schedule twice.
 */
export type ReminderRowAction =
  | { kind: "cta"; cta: ReminderCta }
  | { kind: "answer-plan"; milestoneId: string; schedule: ReminderRuleInput[] }
  | { kind: "snooze"; days: number }
  | { kind: "dismiss" };

/**
 * The "Remind me in…" choices every client offers, in days — tomorrow, in three
 * days, next week *(owner, 2026-09-11)*. Presets, not the rule: `snoozeTargetOf`
 * takes any whole number of days, so a user-chosen duration is one more entry.
 */
export const SNOOZE_PRESET_DAYS: readonly number[] = [1, 3, 7];

/**
 * A stable key for one offered action, for clients rendering the list.
 *
 * `kind` alone is not unique: a row can carry **two** CTAs — its own, and the
 * offer to complete a missing record beside it — and two React children keyed
 * `"cta"` is a duplicate key, which reconciles wrongly rather than loudly. Lives
 * here rather than in each client for the usual reason: there are two of them,
 * and a key chosen locally is a key that drifts.
 */
export function reminderActionKey(action: ReminderRowAction): string {
  if (action.kind === "cta") return `cta:${action.cta.kind}`;
  // Likewise up to three snoozes, one per preset.
  if (action.kind === "snooze") return `snooze:${action.days}`;
  return action.kind;
}

/**
 * Everything a reminder row offers, in the order it should be offered: **do it**
 * ({@link reminderCtaOf}'s call to action), **just the day** (a prompt's one-tap
 * answer), **remind me in…** (snooze), **don't ask again** (dismiss) — which is also
 * order of escalating finality. An ordinary reminder offers none of them and
 * gets an empty list.
 *
 * **Just the day** is a `🗓 plan` prompt's shortcut, and the reason it is an
 * offered action rather than something a row hand-rolls. It is the answer most
 * people will give most of the time — *nothing special, just remind me on the
 * day* — and the whole trade this prompt makes depends on that answer being
 * cheaper than ignoring a row was. It writes the **full** offer set with only
 * `wish` enabled, never just the tick, so it counts as answered for the same
 * reason the form does (see {@link reminderCtaOf}).
 *
 * **Remind me in…** is one `snooze` entry per {@link SNOOZE_PRESET_DAYS} preset
 * that `snoozeTargetOf` allows — on any row, whatever made it *(owner,
 * 2026-09-11)*. That rule leaves out a row due today or belated, and any preset
 * that would land past the due date, so a row due in two days offers *tomorrow*
 * alone. A row not on display yet offers none: putting off something that is not
 * on Today would change nothing.
 *
 * **Dismiss** — *don't ask again* — is offered from the first encounter *(owner,
 * 2026-09-11)*. It used to be withheld until the row had been put off once, so a
 * permanent choice was never the first a layperson saw; the confirmation that
 * follows it says plainly what it does, and with nothing retiring by being put
 * off, it is the one way a question goes for good.
 *
 * It is offered on the rows Leapsake asked unbidden — onboarding nudges, `plan`
 * prompts and partnership questions — not on every row. Ordinary reminders
 * already have this affordance by another route: the row's own remove action,
 * which has always been a permanent tombstone for that occurrence. A second entry
 * here would be a second way to render the same button.
 *
 * A **completed** reminder offers its CTA and nothing else: putting off a row
 * you have just finished is incoherent, and completion winning over snooze is
 * the same precedence {@link partitionReminders} applies.
 *
 * `now` is a parameter so the offer is deterministic and testable; the default
 * is caller convenience. This package does not read the clock.
 */
export function reminderActionsOf(
  reminder: {
    id: string;
    completedAt: number | null;
    /** The row's deadline — no snooze may land past it. */
    dueDate?: number | null;
    /** When it goes on display; a row not on display yet offers no snooze. */
    activeFrom?: number | null;
  },
  context: {
    /** Set when this is a `🎁 gift` reminder — who it's about. */
    giftTarget?: GiftReminderSubject;
    /** Set when this row is today's duplicates nudge. */
    isDuplicatesNudge?: boolean;
    /** Set when this is a `🗓 plan` prompt — what it is asking about. */
    planTarget?: PlanReminderSubject;
    /** Set when this is a `🎉 wish` about a person — see {@link reminderCtaOf}. */
    contactTarget?: ContactReminderSubject;
    /** Set when this row is a partnership question — see {@link reminderCtaOf}. */
    partnershipTarget?: PartnershipReminderSubject;
    /** Set when this row is about an unbound wedding — see {@link reminderCtaOf}. */
    linkPartnerTarget?: LinkPartnerReminderSubject;
  } = {},
  now: number = Date.now(),
): ReminderRowAction[] {
  const cta = reminderCtaOf(reminder, context);
  const actions: ReminderRowAction[] =
    cta === null ? [] : [{ kind: "cta", cta }];
  if (reminder.completedAt !== null) return actions;

  if (cta?.kind === "plan")
    actions.push({
      kind: "answer-plan",
      milestoneId: cta.milestoneId,
      schedule: cta.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "wish",
      })),
    });

  // ⚠️ A **second** call to action, shown beside the first rather than queued
  // behind it *(owner, 2026-09-05)*. A row offers one main CTA — the highest
  // that applies — and "who is this wedding with?" sits below both the question
  // and the gift, so it used to appear only on a row where nothing outranked it:
  // the day-of wish, for a few days a year. A user who answered the prompt with
  // only "get a gift" would never see it at all.
  //
  // It is the one offer that completes a *record* rather than doing the errand,
  // which is what makes it safe to double up: it never competes with the row's
  // own point, and a row that already shows it as the main CTA does not repeat
  // it.
  if (
    context.linkPartnerTarget !== undefined &&
    cta !== null &&
    cta.kind !== "link-partner"
  )
    actions.push({
      kind: "cta",
      cta: { kind: "link-partner", ...context.linkPartnerTarget },
    });

  const notOnDisplayYet =
    reminder.activeFrom !== null &&
    reminder.activeFrom !== undefined &&
    daysUntil(todayCivil(now), civilFromDueMs(reminder.activeFrom)) > 0;
  if (!notOnDisplayYet)
    for (const days of SNOOZE_PRESET_DAYS)
      if (snoozeTargetOf(reminder, days, now) !== null)
        actions.push({ kind: "snooze", days });
  // A prompt earns `dismiss` on the same terms a nudge does. It is the only
  // permanent out from a question the user does not want to answer, and — unlike
  // an ordinary reminder, whose own Remove already is one — a row the client
  // renders as a prompt needs it under an honest label.
  if (
    cta?.kind === "onboarding" ||
    cta?.kind === "plan" ||
    cta?.kind === "partnership"
  )
    actions.push({ kind: "dismiss" });
  return actions;
}
