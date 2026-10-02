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

/** What the reminders list partitions and orders on. */
export interface ReminderStanding {
  completedAt: number | null;
  dueDate: number | null;
  snoozedUntil: number | null;
  createdAt: number;
}

/**
 * Open reminders by due date, done ones newest first, and snoozed ones held
 * back; ⚠️ snooze must stay a display filter, as the README says.
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

/** A row's standing plus the dates only the engine supplies; without them a
 *  row buckets as dateless. */
export interface ReminderTiming extends ReminderStanding {
  /** When this row goes on display; null or absent means it already is. */
  activeFrom?: number | null;
  /** The occasion this row counts down to, which orders belated rows. */
  occurrenceDate?: number | null;
  /** The date the countdown shows where it is not `dueDate`, sorted on. */
  countdownDate?: number | null;
}

/** Which part of the reminders list a row belongs in. */
export type ReminderBucket = "belated" | "today" | "next7" | "later";

/** Every section of the list, the completed one included. */
export type ReminderSection = ReminderBucket | "done";

/** How far ahead *Next 7 days* reaches, beyond which a row is *Later*. */
export const NEXT_DAYS = 7;

/** The day a row enters Today: the later of `activeFrom` and its snooze's
 *  end, or `null` for neither. */
export function landingDayOf(reminder: ReminderTiming): number | null {
  const shown = reminder.activeFrom ?? null;
  const back = reminder.snoozedUntil;
  if (shown === null) return back;
  if (back === null) return shown;
  return Math.max(shown, back);
}

/**
 * Buckets the open reminders into belated, today, next 7 days and later, in
 * whole civil days; see the README's _The reminders list_.
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
  /** Belated plus today: everything that can be done now. */
  owed: number;
} {
  const { open, done, snoozed } = partitionReminders(reminders, now);
  const todayCivilDate = todayCivil(now);
  const daysTo = (ms: number) => daysUntil(todayCivilDate, civilFromDueMs(ms));

  // Two halves each, so which leads is decided here, not by arrival order.
  const salvageable: R[] = [];
  const gone: R[] = [];
  const dateless: R[] = [];
  const dated: R[] = [];
  const next7: R[] = [];
  const later: R[] = [];

  // Snoozed rows join the later sections by the day they come back.
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

  // Every sort is stable, so same-day rows keep their arrival order.
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

/** What a row's countdown counts to, and in which words. */
export type ReminderCountdown =
  | { kind: "due"; date: number }
  | { kind: "back"; date: number }
  | { kind: "coming"; date: number }
  | { kind: "shown"; date: number };

/** A row's countdown in its section: the date the section sorts it by, so
 *  number and place agree; `null` when dateless. */
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

/** The person or pet a `🎁 gift` reminder is about. */
export interface GiftReminderSubject {
  recipientType: GiftPartyType;
  recipientId: string;
}

/** The person, never a pet, a `🎉 wish` is about, and whether they are
 *  reachable; a pet can own no contact method. */
export interface ContactReminderSubject {
  personId: string;
  /** Whether they have any method worth offering — postal excluded upstream. */
  hasMethods: boolean;
}

/** What a `🗓 plan` prompt is asking about. */
export interface PlanReminderSubject {
  milestoneId: string;
  /** Not `kind`, which {@link ReminderCta} discriminates on. */
  milestoneKind: MilestoneKind;
  /** The year of the occasion asked about: the one year an answer covers. */
  occurrenceYear: number;
  /** Every action offered, `enabled` carrying which arrive pre-ticked. */
  offers: ReminderRuleInput[];
}

/** A partnership question's relationship and missing date, whose kind opens
 *  the milestone form already on it. */
export interface PartnershipReminderSubject {
  relationshipId: string;
  milestoneKind: "wedding" | "first-date";
  /** The partner, for a client that would rather route via their page. */
  partnerId: string;
}

/** A couple's occasion with nobody on the other side yet; `isSelf` changes
 *  only the wording. */
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
 * A row's main call to action, the decision and not the route, or `null` for
 * an ordinary reminder; precedence is in the README's _What a row offers_.
 */
export function reminderCtaOf(
  reminder: { id: string; completedAt: number | null },
  context: {
    /** Set when this is a `🎁 gift` reminder: who it's about. */
    giftTarget?: GiftReminderSubject;
    /** Set when this row is today's duplicates nudge. */
    isDuplicatesNudge?: boolean;
    /** Set when this is a `🗓 plan` prompt: what it is asking about. */
    planTarget?: PlanReminderSubject;
    /** Set when this is a `🎉 wish` about a person; absent for a pet. */
    contactTarget?: ContactReminderSubject;
    /** Set when this row is a partnership question. */
    partnershipTarget?: PartnershipReminderSubject;
    /** Set when this row is about a wedding with nobody on the other side. */
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
  // Ahead of `contact`: on your own wedding it would offer to reach yourself.
  if (context.linkPartnerTarget !== undefined)
    return { kind: "link-partner", ...context.linkPartnerTarget };
  // Only the unreachable: a reachable person's methods render as buttons.
  if (context.contactTarget !== undefined && !context.contactTarget.hasMethods)
    return { kind: "contact", personId: context.contactTarget.personId };
  return null;
}

/** One thing a row offers, the decision and not the label; `snooze` carries
 *  days, turned into a date by the same rule that offered it. */
export type ReminderRowAction =
  | { kind: "cta"; cta: ReminderCta }
  | {
      kind: "answer-plan";
      milestoneId: string;
      year: number;
      schedule: ReminderRuleInput[];
    }
  | { kind: "snooze"; days: number }
  | { kind: "dismiss" }
  | { kind: "stop-asking"; milestoneId: string };

/** The “Remind me in…” presets, in days; `snoozeTargetOf` takes any. */
export const SNOOZE_PRESET_DAYS: readonly number[] = [1, 3, 7];

/** A stable key per offered action; `kind` alone repeats, as a row can carry
 *  two CTAs. */
export function reminderActionKey(action: ReminderRowAction): string {
  if (action.kind === "cta") return `cta:${action.cta.kind}`;
  // Likewise up to three snoozes, one per preset.
  if (action.kind === "snooze") return `snooze:${action.days}`;
  return action.kind;
}

/**
 * Everything a row offers, in escalating finality: do it, just the day,
 * remind me in…, don't ask again. See the README's _What a row offers_.
 */
export function reminderActionsOf(
  reminder: {
    id: string;
    completedAt: number | null;
    /** The row's deadline, which no snooze may pass. */
    dueDate?: number | null;
    /** When it goes on display; a row not on display yet offers no snooze. */
    activeFrom?: number | null;
  },
  context: {
    /** Set when this is a `🎁 gift` reminder: who it's about. */
    giftTarget?: GiftReminderSubject;
    /** Set when this row is today's duplicates nudge. */
    isDuplicatesNudge?: boolean;
    /** Set when this is a `🗓 plan` prompt: what it is asking about. */
    planTarget?: PlanReminderSubject;
    /** Set when this is a `🎉 wish` about a person. */
    contactTarget?: ContactReminderSubject;
    /** Set when this row is a partnership question. */
    partnershipTarget?: PartnershipReminderSubject;
    /** Set when this row is about an unbound wedding. */
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
      year: cta.occurrenceYear,
      schedule: cta.offers.map((offer) => ({
        ...offer,
        enabled: offer.action === "wish",
      })),
    });

  // A second CTA beside the first, as it completes a record rather than the
  // errand; not repeated where it is already the main one.
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
  // A nudge's only out is permanent; a prompt's is this year's, or for good.
  if (cta?.kind === "plan")
    actions.push({ kind: "stop-asking", milestoneId: cta.milestoneId });
  if (cta?.kind === "onboarding" || cta?.kind === "partnership")
    actions.push({ kind: "dismiss" });
  return actions;
}
