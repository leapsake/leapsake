import { z } from "zod";
import {
  type KnownReminderAction,
  type ReminderAction,
  type ReminderRule,
  type ReminderRuleInput,
  actionDefOf,
  reminderRuleInputSchema,
  verbOf,
} from "./reminder-rule.js";

/**
 * The kinds of bearer a milestone can hang off. A *separate* enum from
 * `entityTypeSchema`: a `relationship` can be a milestone bearer (a
 * wedding belongs to the relationship, not to either partner) but is not a
 * relationship-role holder, so we don't widen `entityTypeSchema` to include it.
 * Like taggings/relationships, the bearer is a polymorphic `(type, id)` pair,
 * so a new bearer type joins without a schema change.
 */
export const milestoneBearerTypeSchema = z.enum([
  "person",
  "pet",
  "relationship",
]);

export type MilestoneBearerType = z.infer<typeof milestoneBearerTypeSchema>;

/**
 * The closed set of milestone kinds — "the big dates in someone's life". A
 * starter set in v1; adding a kind later is one enum line plus a `kindDefs`
 * entry, never a migration (the DB stores the kind as free text, constrained
 * here in Zod). Insertion order is the UI listing order. `other` is the escape
 * hatch and leans on the free-text `note` for its label.
 */
export const milestoneKindSchema = z.enum([
  "birthday",
  "death",
  "first-date",
  "wedding",
  "anniversary",
  "met",
  "graduation",
  "job-start",
  "moved",
  "other",
]);

export type MilestoneKind = z.infer<typeof milestoneKindSchema>;

/**
 * Whether an unknown value is a {@link MilestoneKind}.
 *
 * Exists because a kind now arrives from a **URL** — the partnership question's
 * CTA opens the milestone form on the kind it asked about (`?kind=wedding`), and
 * a query string is user-editable input, not a trusted value to cast. Both
 * clients read it, so the guard is here rather than written twice.
 */
export function isMilestoneKind(value: unknown): value is MilestoneKind {
  return milestoneKindSchema.safeParse(value).success;
}

/**
 * One entry in a kind's **default** staggered-reminder schedule: an action to
 * take `offsetDays` days before the milestone's occurrence (0 = day-of), and
 * whether it starts on. An action a kind never wants (a "send a text" on a
 * death anniversary) is simply **absent** from its schedule — "disabled
 * entirely"; a present entry with `enabledByDefault: false` is "offered but
 * off". A milestone with no stored rules resolves against this list.
 */
export interface DefaultReminderRule {
  /**
   * A **registered** action, not the open {@link ReminderAction} — the point of
   * authoring against the narrower type is that a typo here (`"gift"` for
   * `"get:gift"`, say) fails to compile instead of shipping a kind whose
   * defaults render through {@link actionDefOf}'s generic fallback.
   */
  action: KnownReminderAction;
  offsetDays: number;
  enabledByDefault: boolean;
}

/** Static metadata for a milestone kind: how it displays, who it attaches to, and whether it recurs. */
export interface MilestoneKindDef {
  /** Display label, e.g. "Birthday". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * Which bearer types may hold this kind, in preference order. A wedding
   * prefers a `relationship` bearer but can sit on a `person` until the
   * relationship exists (the unbound/pending case); a birthday is a `person` or
   * `pet`. The first entry is the {@link MilestoneKindDef.preferredBearerType}.
   */
  allowedBearerTypes: MilestoneBearerType[];
  /**
   * Whether this kind recurs every year (drives the future reminders inbox).
   * Unused by the v1 UI but set now so the inbox increment needs no schema or
   * registry churn.
   */
  recursAnnually: boolean;
  /**
   * The kind's default staggered-reminder schedule — the set of actions and lead
   * times a fresh milestone of this kind offers, each with whether it starts on
   * (a birthday offers a gift and two halves of a card, but only the day-of wish
   * is on; a death anniversary offers only a quiet "remember", off). This is the
   * **sole** driver of what the engine generates by default: a milestone with no
   * stored rules rides this list (`resolveReminderSchedule`), and the engine
   * mints a reminder for every entry whose `enabledByDefault` is set — so the
   * automated surface stays a quiet, opt-in one (only a birthday wish fires until
   * a user turns more on), overridable per-*milestone* without a re-key.
   */
  defaultReminderSchedule: DefaultReminderRule[];
  /**
   * The occasion phrase the `wish` action's copy interpolates — "Wish @Violet **a
   * happy birthday**" — carrying its own article. The holiday catalog supplies
   * the same field per entry, which is what lets one template serve both
   * sources instead of baking "birthday" into the action (see
   * {@link ReminderCopyContext}).
   */
  greeting: string;
  /**
   * The same phrase for an occasion that has already **passed** — "Wish @Violet
   * **a happy belated birthday**" — read by the copy layer once a row reaches
   * the belated state (`@leapsake/reminders`, `ReminderWindowFacts`).
   *
   * A second phrase rather than a rule applied to {@link MilestoneKindDef.greeting},
   * because there is no such rule. A greeting is opaque: it carries its own
   * article and its own sentiment, and while "a happy birthday" takes a
   * "belated" in the middle, "congratulations" takes one at the front and "Eid
   * Mubarak" — a holiday greeting, but the shape is the point — takes one
   * nowhere at all. Splicing a word into an arbitrary phrase produces plausible
   * nonsense, which is exactly the failure this interface's sibling fields exist
   * to prevent.
   *
   * **Optional, and absent means unchanged.** An occasion with no natural
   * belated form keeps its plain greeting, which reads as slightly odd rather
   * than as mangled — the right way round. `death` has none deliberately: its
   * `remember` never reads a greeting, and a "belated remembrance" is not a
   * thing to wish anyone.
   */
  belatedGreeting?: string;
  /**
   * The title a **`wish` about your own occasion** takes, in place of the
   * third-person template — "🎂 It's your birthday!" rather than "Wish @You a
   * happy birthday". Carries its own icon, because it replaces the whole title
   * rather than being interpolated into one (the reminders engine's
   * `renderTitle`), and its own belated form for the days a row lingers after
   * the occasion.
   *
   * ⚠️ **Written out per kind rather than derived, for the same reason
   * {@link MilestoneKindDef.belatedGreeting} is.** There is no rule that turns a
   * kind's name into this sentence: a `job-start` is "your **work**
   * anniversary", a `first-date` is just "your anniversary", and a `graduation`
   * needs the word spelled out. Splicing {@link MilestoneKindDef.label} into a
   * template would produce "It's your started a job!".
   *
   * **Optional, and absent means the ordinary copy stands.** `met` has none
   * deliberately — it records the day you met *someone else*, so a `met` borne by
   * you is not a thing to word — and neither do the kinds whose schedule offers
   * no `wish` at all (`death`, `moved`, `other`).
   */
  selfWish?: { plain: string; belated: string };
  /**
   * Whether an *unconfigured* occasion of this kind asks the user how they want
   * to mark it, and — when it does — the bare noun that question names it by
   * ("How do you want to mark @Violet's **birthday**?").
   *
   * Presence **is** the switch: a kind with no `prompt` never mints one. That is
   * the whole declaration, because everything else the prompt needs is already
   * here — {@link MilestoneKindDef.defaultReminderSchedule} is both the set of
   * actions it offers and, via `enabledByDefault`, which of them arrive
   * pre-ticked. One list, asked at a different moment.
   *
   * ⚠️ **`death` must not have one.** A checkbox list of ways to recognise a
   * death anniversary is exactly the wrong object; its single quiet `remember`
   * is already right. The same reasoning excludes any kind whose schedule offers
   * only one action — a question with one answer is not a question.
   *
   * `onlyOwnPartnership` narrows *who* gets asked, and only `first-date` sets it
   * — see the comment on that kind for why the line falls between it and
   * `wedding` rather than around "is this mine".
   */
  prompt?: { occasion: string; onlyOwnPartnership?: true };
}

/**
 * The milestone-kind registry. `allowedBearerTypes[0]` is the preferred
 * bearer; `recursAnnually` is read by the (deferred) inbox. Insertion order
 * matches {@link milestoneKindSchema} and is the UI listing order.
 */
export const kindDefs: Record<MilestoneKind, MilestoneKindDef> = {
  birthday: {
    label: "Birthday",
    icon: "🎂",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: true,
    greeting: "a happy birthday",
    belatedGreeting: "a happy belated birthday",
    selfWish: {
      plain: "🎂 It's your birthday!",
      belated: "🎂 It was your birthday!",
    },
    prompt: { occasion: "birthday" },
    // "Wish them a happy birthday" day-of is the one reminder on by default
    // anywhere; the staggered gift, card and message actions are offered but
    // start off, for the user to opt into.
    defaultReminderSchedule: [
      // Due a dozen days out, not thirty: a gift is chosen over weeks (which is
      // what `actionDefs["get:gift"].activeDays` says) but it only has to be
      // *in hand* with enough slack to wrap and hand over. The old 30 conflated
      // the two.
      { action: "get:gift", offsetDays: 12, enabledByDefault: false },
      // Buying the card and posting it are two errands on two clocks, which is
      // the whole reason the action carries a qualifier: before the split, one
      // `card` action had to be both and could only have one due date. Both are
      // due when the card has to be *in hand*; `send:card`'s shorter
      // `activeDays` is what makes it the later of the two on the list.
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      // The two deliveries, at one offset on purpose: the prompt asks *in person
      // or by mail?* once for the whole occasion, and a caption that had to say
      // "7 days before, or 9 for the gift" would be describing a distinction
      // nobody made. `activeDays` still differs between them, so the parcel
      // surfaces on the list earlier than the envelope.
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "send:gift", offsetDays: 7, enabledByDefault: false },
      // Nothing channel-specific beside it: `call` and `message:sms` used to sit
      // here and were folded into this one row on 2026-09-05 (see
      // `SCHEDULABLE_ACTIONS`). A channel is a button on the acknowledgment, not
      // a second errand to tick, so "wish them" is the whole of the day-of offer
      // and the person's contact methods hang off the reminder it mints.
      { action: "wish", offsetDays: 0, enabledByDefault: true },
    ],
  },
  death: {
    label: "Death",
    icon: "🕯️",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: true,
    greeting: "a peaceful remembrance",
    // Offers a quiet "remember them", day-of — but off by default (nothing but a
    // birthday wish is on by default). No gift/card/text/call for a death.
    defaultReminderSchedule: [
      { action: "remember", offsetDays: 0, enabledByDefault: false },
    ],
  },
  "first-date": {
    label: "First Date",
    icon: "💞",
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    selfWish: {
      plain: "\u{1F49E} It's your anniversary!",
      belated: "\u{1F49E} It was your anniversary",
    },
    // It prompts, and — like `wedding`, and unlike every other kind that does —
    // only for a relationship **the user is in** *(owner, 2026-09-05)*.
    //
    // That it prompts at all: both its actions ship off, so without the question
    // a first date you record generates nothing at all, which makes recording
    // one pointless.
    //
    // That it prompts *narrowly*: the prompt is the app volunteering a set of
    // errands about an occasion nobody asked it about, which earns its place
    // only where the user has already shown the occasion matters to them. See
    // `@leapsake/reminders` → *Who gets asked*.
    prompt: { occasion: "first date", onlyOwnPartnership: true },
    defaultReminderSchedule: [
      // `get:card` sits above the posting rather than the posting standing alone
      // — see `ReminderActionDef.deliveryOf`. Offered and off, like everything
      // here, so this widens what the prompt *asks* and mints nothing.
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  wedding: {
    label: "Wedding",
    icon: "💍",
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    selfWish: {
      plain: "\u{1F48D} It's your wedding anniversary!",
      belated: "\u{1F48D} It was your wedding anniversary",
    },
    // Named "wedding anniversary", not "wedding": the milestone records the day
    // they married, but the occasion the prompt is asking about is its return.
    //
    // ⚠️ **Gated to your own marriage** *(owner, 2026-09-05)*, which reverses the
    // reading this file carried until then. The argument that other people's
    // wedding anniversaries are an occasion third parties mark is true of
    // *wishing* one, and not of the app **volunteering** a set of errands about
    // one. Nothing here ships enabled, so what the gate actually governs is
    // whether the app asks the question at all — and it should ask only where
    // the user has already shown the occasion matters to them. Someone else's
    // anniversary is still fully remindable; it just has to be asked for, on the
    // milestone's own schedule editor.
    prompt: { occasion: "wedding anniversary", onlyOwnPartnership: true },
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 7, enabledByDefault: false },
      { action: "send:gift", offsetDays: 3, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  anniversary: {
    label: "Anniversary",
    icon: "\u{1F389}",
    // **Person-first, unlike `wedding`.** An anniversary usually arrives from a
    // contact card (iOS/Android both record one against the *contact*, with no
    // second party named), so its preferred bearer is the person it was imported
    // onto. That also keeps it out of the "with whom?" step, which fires on
    // `preferredBearerType(kind) === "relationship"` and has no unbound escape
    // outside Wedding. `relationship` stays allowed so a later re-point is a
    // normal bearer update.
    allowedBearerTypes: ["person", "relationship"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    belatedGreeting: "a happy belated anniversary",
    selfWish: {
      plain: "\u{1F389} It's your anniversary!",
      belated: "\u{1F389} It was your anniversary",
    },
    prompt: { occasion: "anniversary" },
    // A card and an acknowledgment, both offered and both off — the source card
    // says a date matters to this person, not what the user wants done about it.
    // The card is the pair (buy it, then post it or hand it over), because
    // `send:card` alone is a posting with nothing to post — see
    // `ReminderActionDef.deliveryOf`.
    defaultReminderSchedule: [
      { action: "get:card", offsetDays: 12, enabledByDefault: false },
      { action: "send:card", offsetDays: 7, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  met: {
    label: "Met",
    icon: "🤝",
    // No `selfWish`: a `met` records the day you met *someone else*, so one
    // borne by you is not an occasion there is anything to say about.
    allowedBearerTypes: ["relationship", "person"],
    recursAnnually: true,
    greeting: "a happy anniversary",
    belatedGreeting: "a happy belated anniversary",
    defaultReminderSchedule: [
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  graduation: {
    label: "Graduation",
    icon: "🎓",
    allowedBearerTypes: ["person"],
    recursAnnually: false,
    greeting: "congratulations",
    belatedGreeting: "belated congratulations",
    selfWish: {
      plain: "\u{1F393} It's your graduation!",
      belated: "\u{1F393} Congratulations on graduating!",
    },
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 14, enabledByDefault: false },
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  "job-start": {
    label: "Started a job",
    icon: "💼",
    allowedBearerTypes: ["person"],
    recursAnnually: false,
    greeting: "congratulations",
    belatedGreeting: "belated congratulations",
    selfWish: {
      plain: "\u{1F4BC} It's your first day!",
      belated: "\u{1F4BC} Congratulations on the new job!",
    },
    defaultReminderSchedule: [
      { action: "wish", offsetDays: 0, enabledByDefault: false },
    ],
  },
  moved: {
    label: "Moved",
    icon: "🏠",
    allowedBearerTypes: ["person", "pet"],
    recursAnnually: false,
    greeting: "a happy housewarming",
    belatedGreeting: "a happy belated housewarming",
    // A housewarming is a gift occasion — offered, off (nothing but a birthday
    // wish is on by default). TODO (v2): a move wants its own fields (the new
    // address, and the relationship between the two homes) rather than only a
    // date; this kind is the seam that will grow them.
    defaultReminderSchedule: [
      { action: "get:gift", offsetDays: 0, enabledByDefault: false },
      { action: "visit", offsetDays: 0, enabledByDefault: false },
    ],
  },
  other: {
    label: "Other",
    allowedBearerTypes: ["person", "pet", "relationship"],
    recursAnnually: false,
    greeting: "the best",
    // No default reminders for a free-form milestone — the user adds their own.
    defaultReminderSchedule: [],
  },
};

/** The preferred (first allowed) bearer type for a kind. */
export function preferredBearerType(kind: MilestoneKind): MilestoneBearerType {
  return kindDefs[kind].allowedBearerTypes[0];
}

/** Whether `bearerType` is allowed to hold `kind`. */
export function kindAllowsBearer(
  kind: MilestoneKind,
  bearerType: MilestoneBearerType,
): boolean {
  return kindDefs[kind].allowedBearerTypes.includes(bearerType);
}

/** Kinds a given bearer type may hold, in registry order — drives the kind picker. */
export function kindsForBearerType(
  bearerType: MilestoneBearerType,
): { kind: MilestoneKind; label: string }[] {
  return (Object.keys(kindDefs) as MilestoneKind[])
    .filter((kind) => kindAllowsBearer(kind, bearerType))
    .map((kind) => ({ kind, label: kindDefs[kind].label }));
}

/**
 * Where a resolved schedule came from. **Two levels, and that is the finished
 * design** — an earlier one had four (this occasion, this person, all birthdays,
 * the shipped default), resolved per action; it was cut before it was built
 * *(owner, 2026-09-05)*. The reasoning is in
 * [`@leapsake/reminders`](../../reminders/README.md) → *Schedules*, and it is
 * worth reading before adding a third: a second writable level is not one more
 * lookup, it makes all-or-nothing resolution wrong.
 *
 * Returned rather than thrown away because "this occasion has no rules of its
 * own" is not a diagnostic, it is a **product condition**: it is exactly what
 * mints the prompt (`plan`). Answering the prompt writes rows, which flips this
 * to `stored`, which is what stops it being asked again.
 */
export type ReminderScheduleSource = "stored" | "kind-default";

/** A milestone's effective schedule, and which level supplied it. */
export interface ResolvedReminderSchedule {
  rules: ReminderRuleInput[];
  source: ReminderScheduleSource;
  /**
   * When the stored rules were written — epoch ms, UTC — or null for a kind
   * default. Every save replaces the whole set (`replaceForBearer`), so the
   * newest row's `createdAt` is when the user last answered for this occasion:
   * what decides whether an errand was chosen too late for its own deadline
   * ({@link effectiveOffsetDays}) and whether an answer was a partial one
   * ({@link isPartialAnswer}).
   */
  writtenAt: number | null;
}

/**
 * The effective staggered-reminder schedule to show/edit for a milestone:
 * `storedRules` when the milestone has been customised (at least one rule row),
 * otherwise the `kind`'s {@link MilestoneKindDef.defaultReminderSchedule}
 * projected into editable rows. "Missing rows ⇒ kind default" keeps an
 * untouched milestone free of stored rows (and free of sync churn) while the
 * editor always has a populated schedule to render. Ordered furthest-out first
 * (a month → a week → day-of), stable within an equal lead.
 *
 * It answers **with its source** rather than just the rules — see
 * {@link ReminderScheduleSource}. Callers that only render the schedule take
 * `.rules` and ignore the rest.
 *
 * A stored `plan` row is dropped rather than trusted. Nothing writes one (the
 * input schema rejects it), so this only ever fires on a corrupt or hand-edited
 * row — but the failure it prevents is a milestone that has been configured
 * still being asked how to configure it, which reads as the app forgetting.
 */
export function resolveReminderSchedule(
  kind: MilestoneKind,
  storedRules: ReminderRule[],
): ResolvedReminderSchedule {
  const stored = storedRules.filter((r) => verbOf(r.action) !== "plan");
  const source: ReminderScheduleSource =
    stored.length > 0 ? "stored" : "kind-default";
  const rules: ReminderRuleInput[] =
    source === "stored"
      ? stored.map((r) => ({
          action: r.action,
          label: r.label,
          offsetDays: r.offsetDays,
          enabled: r.enabled,
        }))
      : kindDefs[kind].defaultReminderSchedule.map((d) => ({
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        }));
  return {
    rules: [...rules].sort((a, b) => b.offsetDays - a.offsetDays),
    source,
    writtenAt:
      stored.length > 0 ? Math.max(...stored.map((r) => r.createdAt)) : null,
  };
}

/**
 * How many days before the occurrence a kind's prompt comes **due** — the
 * furthest reach of anything the prompt offers, so that ticking any of them
 * still leaves that errand its full run-up rather than handing it back already
 * past due.
 *
 * ```
 * promptOffsetDays = max(offsetDays + activeDays) over the offered set
 * ```
 *
 * With today's numbers a birthday's widest offer is `gift` at `12 + 30`, so the
 * prompt is due **42 days out** and, at `actionDefs.plan.activeDays`, appears
 * 56.
 *
 * Deriving it rather than choosing it is the whole point: ship a
 * commissioned-gift action at `activeDays 60` and every prompt slides earlier by
 * itself, with no second constant to keep in step. Zero for a kind that offers
 * nothing — total by construction, though such a kind never prompts.
 */
export function promptOffsetDays(kind: MilestoneKind): number {
  return Math.max(
    0,
    ...kindDefs[kind].defaultReminderSchedule.map(
      (d) => d.offsetDays + actionDefOf(d.action).activeDays,
    ),
  );
}

/**
 * How much notice an action needs to still be **offered** — the fewest days
 * that must remain before its latest possible deadline ({@link latestOffsetDays})
 * for ticking it to be a promise the user can keep.
 *
 * Two *(owner, 2026-09-11)*: a card that has to be in the post tomorrow is
 * technically possible and not worth offering. The same number decides when an
 * errand chosen at the last minute slides to a later deadline
 * ({@link effectiveOffsetDays}). Data, not architecture.
 */
export const OFFER_NOTICE_DAYS = 2;

/**
 * The latest an action can still be done, in days before the occasion: its own
 * `offsetDays`, unless the action can slide to a later deadline when started
 * late (`latestOffsetDays` on its definition — a gift or a card handed over in
 * person). Never later than its own offset: sliding only ever buys time.
 */
export function latestOffsetDays(
  action: ReminderAction,
  offsetDays: number,
): number {
  const slide = actionDefOf(action).latestOffsetDays;
  return slide === undefined ? offsetDays : Math.min(offsetDays, slide);
}

/**
 * Whether an action can still be offered for an occasion `daysUntilOccurrence`
 * days away. A day-of action fits right up to the occasion — there is always
 * time to reach out on the day. Anything else fits while its latest possible
 * deadline is at least {@link OFFER_NOTICE_DAYS} away.
 *
 * With a birthday's numbers: posting fits while the birthday is 9+ days away
 * (the post date is a week before, plus notice), getting a gift or a card while
 * it is 3+ (in person the day before, plus notice), and wishing always.
 */
export function fitsAt(
  action: ReminderAction,
  offsetDays: number,
  daysUntilOccurrence: number,
): boolean {
  const latest = latestOffsetDays(action, offsetDays);
  return latest === 0
    ? daysUntilOccurrence >= 0
    : daysUntilOccurrence - latest >= OFFER_NOTICE_DAYS;
}

/**
 * What a kind's question offers for an occasion `daysUntilOccurrence` days
 * away: the kind's offer set, taking each action's offset and tick from
 * `storedRules` where the occasion already has them (a question asked again
 * shows last year's answer), and **only what still fits** ({@link fitsAt}).
 * Furthest lead first, like {@link resolveReminderSchedule}.
 *
 * The engine and the screen that answers the question both read this, so the
 * row can never be minted for a question the screen then offers nothing on. A
 * question offering fewer than two actions is not a question, and is not asked.
 */
export function planOffers(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  daysUntilOccurrence: number,
): ReminderRuleInput[] {
  const stored = new Map(storedRules.map((r) => [r.action, r]));
  return kindDefs[kind].defaultReminderSchedule
    .map(
      (d): ReminderRuleInput =>
        stored.get(d.action) ?? {
          action: d.action,
          label: null,
          offsetDays: d.offsetDays,
          enabled: d.enabledByDefault,
        },
    )
    .filter((r) => fitsAt(r.action, r.offsetDays, daysUntilOccurrence))
    .sort((a, b) => b.offsetDays - a.offsetDays);
}

/** When a question comes due, and whether it arrived too late for the usual timing. */
export interface PlanTiming {
  /** Days before the occasion the question comes due. */
  dueOffsetDays: number;
  /**
   * Whether the app learned of the occasion too late for the usual timing. A
   * late question goes on display the day the app learned of the occasion,
   * rather than a fortnight before its due date.
   */
  late: boolean;
}

/**
 * When the question about an occasion comes due, given that the app learned of
 * the occasion `learnedDaysOut` days before it.
 *
 * Normally at {@link promptOffsetDays}. But **you can't be late for something
 * the app has only just learned** *(owner, 2026-09-11)*: when that deadline
 * would leave less than {@link OFFER_NOTICE_DAYS} — an import, a person added a
 * month before their birthday — the question is instead due **when the user
 * would start losing an option**: the last day the soonest-to-expire of its
 * remaining offers is still on offer. Ignoring it past that genuinely loses
 * something, which is what makes being overdue honest.
 *
 * Only offers that expire before the occasion count, so a question left with
 * nothing but day-of offers is due on the day itself. An offer whose last day
 * is the day the app learned of the occasion is still offered but does not set
 * the deadline, or the question would be overdue the morning after it arrived.
 */
export function planTiming(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  learnedDaysOut: number,
): PlanTiming {
  const usual = promptOffsetDays(kind);
  if (learnedDaysOut - usual >= OFFER_NOTICE_DAYS)
    return { dueOffsetDays: usual, late: false };
  const lastDays = planOffers(kind, storedRules, learnedDaysOut)
    .map((r) => latestOffsetDays(r.action, r.offsetDays))
    .filter((latest) => latest > 0)
    .map((latest) => latest + OFFER_NOTICE_DAYS)
    .filter((lastDay) => lastDay < learnedDaysOut);
  return { dueOffsetDays: Math.max(0, ...lastDays), late: true };
}

/**
 * Whether a stored schedule answered a question that could no longer offer
 * everything — written `writtenDaysOut` days before the occasion it answered,
 * when some of the kind's offers no longer fit. Such an answer covers **that
 * year only** *(owner, 2026-09-11)*: the question comes back for the next
 * occurrence, on its usual timing and with everything on offer, and stops once
 * it is answered in time.
 */
export function isPartialAnswer(
  kind: MilestoneKind,
  storedRules: readonly ReminderRuleInput[],
  writtenDaysOut: number,
): boolean {
  if (kindDefs[kind].prompt === undefined) return false;
  return (
    planOffers(kind, storedRules, writtenDaysOut).length <
    kindDefs[kind].defaultReminderSchedule.length
  );
}

/**
 * The deadline an errand actually has for one occurrence, in days before it,
 * given that its rule was written `learnedDaysOut` days before that occurrence.
 *
 * Its own `offsetDays`, unless that left less than {@link OFFER_NOTICE_DAYS} —
 * **you can't be late for something you only just chose.** Then it slides to the
 * latest the action can still be done ({@link latestOffsetDays}): a gift chosen
 * five days out is due the day before, in person. An action with no later
 * deadline (posting) keeps its own, and a rule written after the occasion is
 * left alone. The next occurrence is always far enough out for the usual
 * deadline, so this corrects one year and leaves nothing to clean up.
 */
export function effectiveOffsetDays(
  action: ReminderAction,
  offsetDays: number,
  learnedDaysOut: number,
): number {
  if (learnedDaysOut < 0 || learnedDaysOut - offsetDays >= OFFER_NOTICE_DAYS)
    return offsetDays;
  return latestOffsetDays(action, offsetDays);
}

/**
 * One occurrence's rules paired with the deadline each actually has:
 * {@link effectiveOffsetDays} applied to the **set** rather than rule by rule,
 * so that the order the authored offsets encode survives into the due dates.
 *
 * ⚠️ **This is the ordering guarantee, and it is deliberately not a dependency
 * graph** (see `@leapsake/reminders` → *Do not model rule dependencies*). The
 * authored numbers already say what comes first — a card is bought at 12 and
 * posted at 7, so buying leads — and nothing here reads a relation between two
 * actions. It only refuses to *break* an order the offsets already carry, which
 * is what makes it total: it covers every pair, including the ones nobody
 * thought to declare a relation for.
 *
 * Sliding is what put them out of order, so **the repair is not to slide** — not
 * to slide less far. An errand something else waits on keeps its own deadline,
 * which by construction is no earlier than anything authored after it (the walk
 * is furthest-lead-first, and a slide only ever buys time). A rule that slides
 * without crossing anything slides exactly as it did before.
 *
 * Pass only the rules that will actually be materialized — the engine passes the
 * enabled ones. That is also the answer to the question a literal dependency
 * would have had to ask: a rule that is off is not in the set, so it constrains
 * nothing.
 */
export function effectiveOffsets(
  rules: readonly ReminderRuleInput[],
  learnedDaysOut: number,
): { rule: ReminderRuleInput; offsetDays: number }[] {
  // Furthest lead first — the order the authored offsets put them in, and the
  // order the result must keep. Sorted here rather than trusted from the caller:
  // `resolveReminderSchedule` already sorts this way, but a caller that did not
  // would otherwise get no guarantee at all, silently.
  const timed = [...rules]
    .sort((a, b) => b.offsetDays - a.offsetDays)
    .map((rule) => ({
      rule,
      offsetDays: effectiveOffsetDays(
        rule.action,
        rule.offsetDays,
        learnedDaysOut,
      ),
    }));
  // Walk back from the last, carrying the deadline of everything already fixed:
  // no rule may come due after one authored to follow it.
  let floor = 0;
  for (let i = timed.length - 1; i >= 0; i--) {
    const t = timed[i]!;
    if (t.offsetDays < floor) t.offsetDays = t.rule.offsetDays;
    floor = t.offsetDays;
  }
  return timed;
}

/**
 * A Milestone — one dated fact about a bearer, stored as a single row.
 *
 * The date is **partial**: `year`/`month`/`day` are individually nullable so a
 * milestone can record exactly what's known ("March 9, 1992", "March 1992",
 * "1992", "March 9" for a recurring birthday whose year is unknown). The only
 * structural rule is **day ⇒ month** (never a lone day, never year+day);
 * precision is *derived* from which parts are present (see
 * {@link datePrecisionOf}), not stored. The nullable parts stay individually
 * queryable so the future inbox can scan `month`/`day` ignoring `year`.
 *
 * The bearer is a polymorphic, *mutable* `(bearerType, bearerId)` pair: a
 * wedding added before its relationship exists lives on the person and is
 * later re-pointed to the relationship via a single-row bearer update.
 *
 * Same sync-safe conventions as the other tables (see AGENTS.md): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt`.
 */
export const milestoneSchema = z
  .object({
    id: z.uuid(),
    kind: milestoneKindSchema,
    bearerType: milestoneBearerTypeSchema,
    bearerId: z.uuid(),
    year: z.number().int().nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
    note: z.string().min(1).nullable(), // free text; also the `other`-kind label
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((m) => m.day === null || m.month !== null, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((m) => kindAllowsBearer(m.kind, m.bearerType), {
    message: "bearerType is not allowed to hold this milestone kind",
    path: ["bearerType"],
  });

export type Milestone = z.infer<typeof milestoneSchema>;

/**
 * The **plaintext, remind-relevant** projection of a milestone: everything the
 * automated-reminder engine needs to decide whether and when to remind, and
 * **nothing that is encrypted**. It deliberately omits `note` (a per-item
 * ciphertext field), so a cross-bearer scan reads it with no content key and no
 * decryption — served straight off `ix_milestones_recurring (month, day)`. The
 * engine's milestone-reader port returns these.
 */
export interface RemindEligibleMilestone {
  id: string;
  kind: MilestoneKind;
  bearerType: MilestoneBearerType;
  bearerId: string;
  year: number | null;
  month: number | null;
  day: number | null;
  /**
   * When the milestone was recorded — epoch ms, UTC. The day the app *learned*
   * of the occasion, which is what keeps a deadline that had already passed by
   * then from counting against the user ({@link planTiming}), and an occasion
   * that had already been from being reminded at all.
   */
  createdAt: number;
}

/**
 * One entry on an entity's milestone timeline: either a milestone stored
 * directly on the entity (`own`, editable in place) or one stored on a
 * relationship the entity participates in (`relationship`, shown read-only with
 * the other partner's label and a link out to the relationship's page). The
 * composition that builds these — own milestones plus a 1-hop join over the
 * entity's explicit relationships — lives in `@leapsake/data`'s
 * `listTimelineForEntity`; nothing is materialised.
 */
export interface MilestoneTimelineEntry {
  milestone: Milestone;
  origin: "own" | "relationship";
  /** The relationship the milestone is stored on; null for `own` entries. */
  relationshipId: string | null;
  /** The other partner's display label; null for `own` entries. */
  otherLabel: string | null;
}

/** The date parts shared by create/update inputs; the day⇒month rule re-applies on each. */
const datePartsShape = {
  year: z.number().int().nullable().optional(),
  month: z.number().int().min(1).max(12).nullable().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  note: z.string().min(1).nullable().optional(),
};

/** A day is meaningful only alongside a month, on partial inputs too (treating absent as null). */
function dayImpliesMonth(d: { month?: number | null; day?: number | null }) {
  return (d.day ?? null) === null || (d.month ?? null) !== null;
}

/**
 * The optional per-milestone staggered-reminder schedule the forms submit
 * alongside the milestone. When present, it **replaces** the milestone's stored
 * rule set (an empty array clears it back to "no reminders"); when absent, the
 * stored rules are left untouched — so an untouched milestone keeps riding its
 * kind defaults. Persisted in the same transaction as the milestone write.
 */
const reminderScheduleShape = {
  reminderSchedule: z.array(reminderRuleInputSchema).optional(),
};

/** The bearer + kind + partial date accepted when creating a milestone. */
export const createMilestoneInputSchema = z
  .object({
    kind: milestoneKindSchema,
    bearerType: milestoneBearerTypeSchema,
    bearerId: z.uuid(),
    ...datePartsShape,
    ...reminderScheduleShape,
  })
  .refine(dayImpliesMonth, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((m) => kindAllowsBearer(m.kind, m.bearerType), {
    message: "bearerType is not allowed to hold this milestone kind",
    path: ["bearerType"],
  });

export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>;

/**
 * Editable fields when updating a milestone: the kind, the date parts, and the
 * note — **plus** an optional new `bearerType`/`bearerId`, so the v2 rebind
 * (unbound person → relationship) is a normal update. The repository merges
 * this onto the stored row and re-validates the whole row, so the day⇒month and
 * bearer-type rules still hold after a partial update.
 */
export const updateMilestoneInputSchema = z.object({
  kind: milestoneKindSchema.optional(),
  bearerType: milestoneBearerTypeSchema.optional(),
  bearerId: z.uuid().optional(),
  ...datePartsShape,
  ...reminderScheduleShape,
});

export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>;

/**
 * The precision of a milestone's date, derived from which parts are present:
 * `none` (nothing), `year` (year only), `year-month` (a month, with or without
 * a year), `recurring` (month+day, no year — recurs annually with no anchor
 * year), or `full` (year+month+day). The day⇒month rule means these cases are
 * exhaustive (a lone day can't occur).
 */
export type DatePrecision =
  | "none"
  | "year"
  | "year-month"
  | "recurring"
  | "full";

/** Derive a milestone's {@link DatePrecision} from its present date parts. */
export function datePrecisionOf(m: {
  year: number | null;
  month: number | null;
  day: number | null;
}): DatePrecision {
  const hasYear = m.year !== null;
  const hasMonth = m.month !== null;
  const hasDay = m.day !== null;
  if (hasMonth && hasDay) return hasYear ? "full" : "recurring";
  if (hasMonth) return "year-month"; // year+month, or the rarer month-only
  return hasYear ? "year" : "none";
}

/** A reference January (any year with 31-day months works) for month-name formatting. */
const MONTH_NAMES = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2001, i, 1)).toLocaleDateString(undefined, {
    month: "long",
    timeZone: "UTC",
  }),
);

/**
 * A locale-aware, precision-aware rendering of a milestone's partial date:
 * "March 9, 1992" (full), "March 1992" (year-month), "1992" (year only),
 * "March 9" (recurring, no year), or "" when no date is set. Built from the
 * individual parts rather than a `Date` so a partial date never implies a day
 * or month it doesn't have.
 */
export function formatMilestoneDate(m: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string {
  const monthName = m.month !== null ? MONTH_NAMES[m.month - 1] : null;
  switch (datePrecisionOf(m)) {
    case "full":
      return `${monthName} ${m.day}, ${m.year}`;
    case "recurring":
      return `${monthName} ${m.day}`;
    case "year-month":
      // A month, with the year when known; "March 1992" or just "March".
      return m.year !== null ? `${monthName} ${m.year}` : (monthName ?? "");
    case "year":
      return String(m.year);
    default:
      return "";
  }
}

/**
 * The display label for a milestone: the kind's label, except `other`, which
 * uses its free-text `note` (falling back to "Other" when blank).
 */
export function milestoneLabel(m: {
  kind: MilestoneKind;
  note: string | null;
}): string {
  if (m.kind === "other") return m.note ?? kindDefs.other.label;
  return kindDefs[m.kind].label;
}
