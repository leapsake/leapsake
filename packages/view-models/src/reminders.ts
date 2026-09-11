import {
  type OnboardingRoute,
  onboardingRouteOf,
  snoozePolicyOf,
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
 * `done`, not pending. A row is snoozed while `snoozedUntil > now` — strictly
 * greater, so the moment the clock arrives it is open again rather than spending
 * a millisecond in limbo. `dueDate` is untouched by any of this: an un-snoozed
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
  const isSnoozed = (r: R) => r.snoozedUntil !== null && r.snoozedUntil > now;

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
   * display** — a dateless nudge, or a user reminder, which is a row from the
   * moment it is written.
   */
  activeFrom?: number | null;
  /**
   * The occasion this row counts down to, if it has one. It is what separates
   * *past due* from *belated*; see {@link bucketReminders}.
   */
  occurrenceDate?: number | null;
}

/** Which part of the reminders list a row belongs in. */
export type ReminderBucket =
  | "past-due"
  | "belated"
  | "today"
  | "available"
  | "coming";

/**
 * The reminders list, split the way the screen shows it — the display half of
 * what the engine's window already knows, and a strict refinement of
 * {@link partitionReminders}, which it calls first and whose `done` / `snoozed`
 * buckets it passes straight through.
 *
 * The problem it solves: one flat list of everything open makes a month-long
 * gift errand indistinguishable from the wish owed this morning, so there is no
 * way to clear the screen and feel finished. Five buckets, split by **due
 * date**, with activity deciding only whether a row is on the main screen at
 * all:
 *
 * - **past due** — the deadline blew while the occasion is still ahead. Acting
 *   now still has the most value of anything on the screen (the card missed its
 *   post date, but the birthday is Tuesday, so pay for express), which is the
 *   argument for putting it first.
 * - **belated** — the occasion itself has gone. Prominent, but below past due:
 *   nothing can be recovered here, only acknowledged.
 * - **today** — due today, plus every dateless row (see below).
 * - **available** — on display, but due later. A month-long gift lives here the
 *   whole time. It is visible, it is tickable, and it deliberately does **not**
 *   count against being done today.
 * - **coming** — not active yet. Behind an expander, ordered by when it lands.
 *
 * ⚠️ **`owed` is what "done for the day" measures** — past due + belated +
 * today, and nothing else. That separation is the whole point: a gift project
 * that sits on screen for a month must never make the day unfinishable. Both
 * readings are returned, `owed` and `actionable`, so the copy can say which kind
 * of done was reached; which one it celebrates is the client's call.
 *
 * **Dateless rows are owed** *(owner, 2026-09-04)*. An onboarding nudge, the
 * duplicates nudge and an undated user reminder have no due date to sort on, and
 * they go in `today` alongside the dated rows rather than sinking into
 * `available`. The consequence is deliberate and known: a nudge that waits for
 * an account rather than for days keeps the day unfinishable while it stands.
 *
 * ⚠️ **A row with no occurrence is never belated.** An overdue user reminder is
 * still salvageable — nothing has *passed* — so it reads as past due. Belated
 * requires a known occasion that has gone, which is why `occurrenceDate` has to
 * travel with the row: `dueDate` alone cannot recover it, the action not being a
 * column.
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
  pastDue: R[];
  belated: R[];
  today: R[];
  available: R[];
  coming: R[];
  done: R[];
  snoozed: R[];
  /** past due + belated + today — what "done for the day" measures. */
  owed: number;
  /** owed + available — everything that could possibly be done right now. */
  actionable: number;
} {
  const { open, done, snoozed } = partitionReminders(reminders, now);
  const todayCivilDate = todayCivil(now);
  const daysTo = (ms: number) => daysUntil(todayCivilDate, civilFromDueMs(ms));

  const pastDue: R[] = [];
  const belated: R[] = [];
  const today: R[] = [];
  const available: R[] = [];
  const coming: R[] = [];

  for (const reminder of open) {
    const { activeFrom, dueDate, occurrenceDate } = reminder;
    if (
      activeFrom !== null &&
      activeFrom !== undefined &&
      daysTo(activeFrom) > 0
    ) {
      coming.push(reminder);
    } else if (dueDate === null) {
      today.push(reminder);
    } else {
      const untilDue = daysTo(dueDate);
      if (untilDue > 0) available.push(reminder);
      else if (untilDue === 0) today.push(reminder);
      else if (
        occurrenceDate !== null &&
        occurrenceDate !== undefined &&
        daysTo(occurrenceDate) < 0
      )
        belated.push(reminder);
      else pastDue.push(reminder);
    }
  }

  // `open` arrives soonest-due-first and the buckets preserve it, so only
  // `coming` needs its own order: it is read as a schedule of arrivals, not of
  // deadlines, so it sorts on the date it will land.
  coming.sort((a, b) => (a.activeFrom ?? 0) - (b.activeFrom ?? 0));

  const owed = pastDue.length + belated.length + today.length;
  return {
    pastDue,
    belated,
    today,
    available,
    coming,
    done,
    snoozed,
    owed,
    actionable: owed + available.length,
  };
}

/**
 * The *coming* bucket grouped by the day each row lands, ascending — one group
 * per distinct activation date, so the expander reads as a schedule rather than
 * a wall.
 *
 * Grouping and not labelling: a group carries its `activeFrom` and the client
 * formats it (`formatDueIn`), because the distance is a moving number and a
 * written-in "next month" would be wrong by tomorrow.
 *
 * Rows with no activation date cannot be in this bucket, so they cannot reach
 * here; the fallback exists only to keep the function total.
 */
export function groupComingByActivation<R extends ReminderTiming>(
  coming: readonly R[],
): { activeFrom: number; reminders: R[] }[] {
  const groups = new Map<number, R[]>();
  for (const reminder of coming) {
    const at = reminder.activeFrom ?? 0;
    const group = groups.get(at);
    if (group === undefined) groups.set(at, [reminder]);
    else group.push(reminder);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([activeFrom, reminders]) => ({ activeFrom, reminders }));
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
 * An unbound wedding's subject: the milestone with nobody on the other side of
 * it, and the person it is currently stored on.
 *
 * ⚠️ **Weddings only, and that is not an oversight.** A wedding is the one
 * occasion between two people that can be recorded knowing only one of them —
 * the create form offers "unknown" for it and for nothing else. A `first-date` or
 * a `met` stored on a person *is* about that person, so asking who it is with
 * would be asking a question whose answer is in the row.
 */
export interface LinkPartnerReminderSubject {
  milestoneId: string;
  personId: string;
  /**
   * Whether the wedding is the **user's own**, which is only a wording
   * difference — "who is your spouse?" rather than "add who it's with". Worth
   * carrying because it is the case the whole affordance was asked for: an
   * anniversary entered before the other person is in the app at all.
   */
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
 * `snooze` carries the date it would run to, so the client hands it straight to
 * the one write method and nobody derives the schedule twice.
 */
export type ReminderRowAction =
  | { kind: "cta"; cta: ReminderCta }
  | { kind: "answer-plan"; milestoneId: string; schedule: ReminderRuleInput[] }
  | { kind: "snooze"; until: number }
  | { kind: "dismiss" };

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
  return action.kind === "cta" ? `cta:${action.cta.kind}` : action.kind;
}

/**
 * Everything a reminder row offers, in the order it should be offered: **do it**
 * ({@link reminderCtaOf}'s call to action), **just the day** (a prompt's one-tap
 * answer), **not now** (snooze), **don't ask again** (dismiss) — which is also
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
 * **Snooze** comes from `snoozePolicyOf`, which answers "can this still be put
 * off" and "until when" in one evaluation, so the offer and its date can never
 * disagree. `null` from it means no entry — for either of two reasons this
 * function neither knows nor needs: the row is not an onboarding nudge, or the
 * step has spent its repetitions and is about to retire. The dials it reads (how
 * many days, how many repetitions) stay private to `@leapsake/reminders`; the
 * `until` here is that function's answer verbatim, never a recomputation, so the
 * copy can honestly say “ask me in 3 days” and changing the dial changes both.
 *
 * **Dismiss** is withheld until the row has been put off at least once. First
 * encounter stays a binary choice — do it or not now — because a permanent
 * "never ask me again" offered before the user knows what they are declining is
 * a trap for exactly the layperson this product is for. It appears from the
 * second encounter on, and it *outlives* snooze: a step that has exhausted its
 * repetitions offers no snooze but must still be endable.
 *
 * It is offered on **onboarding nudges only**, though, not on every put-off row.
 * Ordinary reminders already have this affordance by another route — the row's
 * own remove action, which has always been a permanent tombstone. A second
 * entry here would be a second way to render the same button. Whether a snoozed
 * *user* reminder should grow one is a real question, and it belongs to whoever
 * builds snooze-for-user-reminders, not to this function pre-empting them.
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
    snoozeCount: number;
    /** A prompt's own deadline — `snoozePolicyOf` clamps "not now" to it. */
    dueDate?: number | null;
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

  const policy = snoozePolicyOf(
    {
      ...reminder,
      isPlanPrompt: cta?.kind === "plan",
      isPartnershipNudge: cta?.kind === "partnership",
    },
    now,
  );
  if (policy !== null) actions.push({ kind: "snooze", until: policy.until });
  // A prompt earns `dismiss` on the same terms a nudge does. It is the only
  // permanent out from a question the user does not want to answer, and — unlike
  // an ordinary reminder, whose own Remove already is one — a row the client
  // renders as a prompt needs it under an honest label.
  if (
    (cta?.kind === "onboarding" ||
      cta?.kind === "plan" ||
      cta?.kind === "partnership") &&
    reminder.snoozeCount >= 1
  )
    actions.push({ kind: "dismiss" });
  return actions;
}
