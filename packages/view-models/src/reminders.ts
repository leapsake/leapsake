import { type OnboardingRoute, onboardingRouteOf } from "@leapsake/reminders";
import { type GiftPartyType, compareReminderDue } from "@leapsake/schema";

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

/** The person or pet a `🎁 gift` reminder is about. Core's `GiftReminderTarget` satisfies it. */
export interface GiftReminderSubject {
  recipientType: GiftPartyType;
  recipientId: string;
}

/**
 * Where a reminder row's call to action leads — the *decision*, not the route.
 * Each client maps this to its own router path and its own copy, since the two
 * routers spell the same screen differently and the label is user-visible text.
 */
export type ReminderCta =
  | { kind: "onboarding"; route: OnboardingRoute }
  | { kind: "duplicates" }
  | ({
      kind: "gift";
      action: "see-gifts" | "record-giving";
    } & GiftReminderSubject);

/**
 * The call to action a reminder row offers, or `null` for the ordinary reminders
 * (user-written, birthday, milestone, holiday) that just sit there and get done.
 *
 * Three kinds, in precedence order — no reminder is ever eligible for two, so the
 * order only fixes the shape of the check:
 *
 * 1. an **onboarding** nudge, identified by its well-known id
 *    ({@link onboardingRouteOf}) and deep-linking to the step it asks for;
 * 2. the **duplicates** nudge, whose id is content-addressed on the outstanding
 *    pair set and so is passed in by the caller rather than looked up;
 * 3. a **`🎁 gift`** reminder, whose target flips on completion — the loop the
 *    reminder itself opens. *Open:* the recipient's own page, whose Gifts section
 *    lists what's already suggested for them (and what they've been given, so you
 *    don't repeat yourself). *Done:* logging what you actually gave.
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
  } = {},
): ReminderCta | null {
  const onboardingRoute = onboardingRouteOf(reminder.id);
  if (onboardingRoute !== null)
    return { kind: "onboarding", route: onboardingRoute };
  if (context.isDuplicatesNudge === true) return { kind: "duplicates" };
  if (context.giftTarget !== undefined) {
    return {
      kind: "gift",
      action: reminder.completedAt !== null ? "record-giving" : "see-gifts",
      recipientType: context.giftTarget.recipientType,
      recipientId: context.giftTarget.recipientId,
    };
  }
  return null;
}
