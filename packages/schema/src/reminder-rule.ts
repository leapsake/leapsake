import { z } from "zod";

/**
 * The closed set of reminder **actions** — the "what to do" of a staggered
 * reminder (get a gift, send a card, give a call…). A starter set; adding an
 * action later is one enum line plus an `actionDefs` entry, never a migration
 * (the DB stores the action as free text, constrained here in Zod). Insertion
 * order is the UI listing order. `other` is the escape hatch and leans on the
 * per-rule free-text `label`, exactly like the `other` milestone kind leans on
 * its `note`.
 *
 * One member is **not** a thing the user schedules: `plan` is the engine's
 * question — *"how do you want to mark this?"* — asked of an occasion nobody has
 * configured. It is synthesized per reconcile and never stored as a rule, so the
 * set a schedule may draw from is {@link SCHEDULABLE_ACTIONS}, not this enum.
 */
export const reminderActionSchema = z.enum([
  "wish",
  "gift",
  "card",
  "call",
  "text",
  "visit",
  "remember",
  "plan",
  "other",
]);

export type ReminderAction = z.infer<typeof reminderActionSchema>;

/**
 * What a reminder's copy is written about: who, and what occasion.
 *
 * Passed as an object rather than positionally on purpose. The `greeting` was
 * added when holidays joined milestones as a reminder source, and a forgotten
 * positional argument would have silently rendered birthday copy for Christmas
 * — a failure that typechecks and reads fine in review.
 */
export interface ReminderCopyContext {
  /** The bearer's display label, already mention-wrapped where applicable. */
  subject: string;
  /**
   * The occasion phrase, carrying its own article where it needs one: "a happy
   * birthday", "a Merry Christmas", "Eid Mubarak". Supplied by the milestone
   * kind (`kindDefs`) or the holiday catalog entry, so one template serves both.
   */
  greeting: string;
  /**
   * The occasion as a bare noun — "birthday", "wedding anniversary",
   * "Christmas" — for copy that *names* the occasion instead of wishing it.
   *
   * Deliberately separate from {@link ReminderCopyContext.greeting} rather than
   * derived from it: a greeting carries an article and a sentiment ("**a happy**
   * birthday") that read as nonsense in a question ("How do you want to mark
   * Alice's a happy birthday?"). Two fields, because the two jobs genuinely
   * differ; and required, not optional, for the reason this whole interface is
   * an object — a missing one here renders plausible copy that typechecks.
   */
  occasion: string;
}

/** Static metadata for a reminder action: how it displays, how long it takes,
 *  and its default copy. */
export interface ReminderActionDef {
  /** Display label, e.g. "Get a gift". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * How many days **before its due date** a reminder for this action goes on
   * display. Not when it comes due — how long the errand then sits on the list.
   *
   * It lives on the **action**, not on a kind's `defaultReminderSchedule`,
   * because it describes the *work*: a gift is a project whatever the occasion
   * — buy it, wrap it, post it — while a phone call takes minutes and cannot be
   * done early. `offsetDays`, which says when the thing is **due**, stays
   * per-kind, because that genuinely does vary by occasion.
   *
   * `0` means "appears on its due date, not before". A `wish` is offset 0,
   * active 0, so it shows up on the day. Required rather than optional so a new
   * action cannot silently inherit a window nobody chose for it.
   *
   * **Provisional numbers, not architecture** — data, like the onboarding snooze
   * dials in `@leapsake/reminders`, and expected to be corrected once real use
   * disagrees.
   */
  activeDays: number;
  /**
   * The reminder copy this action produces, e.g.
   * `` ({subject}) => `Get ${subject} a gift` ``. Most actions ignore the
   * occasion entirely — a gift is a gift — but {@link ReminderCopyContext.greeting}
   * is what lets `wish` serve both "Wish @Alice a happy birthday" and "Wish
   * @Alice a Merry Christmas" from one template. `other` has no fixed template —
   * its copy is the rule's free-text {@link ReminderRule.label} (see
   * {@link reminderRuleLabel}) — so it falls back to its plain label.
   */
  template: (context: ReminderCopyContext) => string;
}

/**
 * The reminder-action registry, parallel to `kindDefs`. Insertion order matches
 * {@link reminderActionSchema} and is the UI listing order.
 */
export const actionDefs: Record<ReminderAction, ReminderActionDef> = {
  wish: {
    label: "Wish them",
    icon: "🎉",
    // Day-of, and only day-of. "Happy birthday" said a week early is not a
    // reminder you can act on, so it appears on the morning it is owed — the
    // single change that empties a month of standing birthday rows off Home.
    activeDays: 0,
    // The one action whose copy turns on the occasion. With a birthday's
    // greeting this renders exactly the string the birthday-only engine used to
    // hard-code, which is what keeps existing reminders from drifting on
    // upgrade; with a holiday's it reads "Wish @Alice a Merry Christmas".
    template: ({ subject, greeting }) => `Wish ${subject} ${greeting}`,
  },
  gift: {
    label: "Get a gift",
    icon: "🎁",
    // The longest window of any action: choosing a gift is the one errand here
    // that genuinely wants weeks, and it is the reason `activeDays` had to exist
    // at all.
    activeDays: 30,
    template: ({ subject }) => `Get ${subject} a gift`,
  },
  card: {
    label: "Send a card",
    icon: "💌",
    // *Send*, per the label — buying it is `gift`'s cousin and gets its own
    // action when the verb/qualifier split lands. A fortnight is enough runway
    // to write and post one.
    activeDays: 14,
    template: ({ subject }) => `Send ${subject} a card`,
  },
  call: {
    label: "Give a call",
    icon: "📞",
    // Minutes, and cannot be done early — day-of like `wish`.
    activeDays: 0,
    template: ({ subject }) => `Call ${subject}`,
  },
  text: {
    label: "Send a text",
    icon: "💬",
    activeDays: 0,
    template: ({ subject }) => `Text ${subject}`,
  },
  visit: {
    label: "Visit",
    icon: "🏡",
    // Due day-of, but worth a week's warning: seeing someone needs arranging,
    // even though the visit itself happens on the day.
    activeDays: 7,
    template: ({ subject }) => `Visit ${subject}`,
  },
  remember: {
    label: "Remember them",
    icon: "🕯️",
    // A death anniversary asks for nothing in advance. It arrives on the day and
    // says so quietly.
    activeDays: 0,
    template: ({ subject }) => `Remember ${subject}`,
  },
  plan: {
    label: "Decide how to mark it",
    icon: "🗓",
    // A fortnight to answer a question, which is a different kind of number from
    // the rest of this registry: every other `activeDays` is how long an
    // *errand* wants, this is how long a *decision* should sit before it is
    // owed. It is deliberately shorter than the run-up of the longest thing the
    // question offers, because the question's own due date is derived from that
    // run-up (`promptOffsetDays`) — the prompt has to come and go before the
    // errands it unlocks would have needed starting.
    //
    // ⚠️ If eight weeks turns out to feel too early to be asked, the dial to
    // turn is `gift`'s `activeDays`, not this one: that is where the pressure
    // actually comes from, and it is where the arithmetic reads it.
    activeDays: 14,
    // Names the occasion rather than wishing it — see `occasion` on
    // {@link ReminderCopyContext}. No distance in the copy: the row's countdown
    // is rendered from its due date (`formatDueIn`), and a written-in "in two
    // months" would be wrong by tomorrow.
    template: ({ subject, occasion }) =>
      `How do you want to mark ${subject}'s ${occasion}?`,
  },
  other: {
    label: "Other",
    icon: "🔔",
    // The user picked the lead time themselves, via the rule's own `offsetDays`;
    // a window on top of it would be second-guessing them.
    activeDays: 0,
    // No fixed copy — the rule's free-text `label` is the reminder text.
    template: () => actionDefs.other.label,
  },
};

/**
 * The actions a **schedule** may contain — every action except `plan`.
 *
 * `plan` is the engine's own question about an unconfigured occasion, not an
 * errand the user picks: it is synthesized per reconcile from
 * `promptOffsetDays`, and a stored `plan` rule would both mint a prompt for an
 * occasion that has by definition already been answered and offer "decide how to
 * mark it" as one of the things you might decide to do.
 *
 * So this, and not `reminderActionSchema.options`, is what a picker lists and
 * what {@link reminderRuleInputSchema} accepts. Both schedule editors read it
 * directly, which is why it lives here rather than being filtered at each of
 * them.
 */
export const SCHEDULABLE_ACTIONS = reminderActionSchema.options.filter(
  (action) => action !== "plan",
) as [ReminderAction, ...ReminderAction[]];

/**
 * The widest {@link ReminderActionDef.activeDays} any action declares.
 *
 * For callers that must narrow a set of *candidate occurrences* before they know
 * which actions will apply to them — `@leapsake/core`'s holiday candidate walk
 * pairs this with the widest `offsetDays` actually in use. Taking the two maxima
 * independently is deliberately generous: the sum only has to **bound** the real
 * (offset + active) reach of any single rule, never match it, and an
 * under-estimate would silently drop occurrences instead of failing.
 */
export const MAX_ACTIVE_DAYS: number = Math.max(
  ...Object.values(actionDefs).map((def) => def.activeDays),
);

/**
 * The bearer types a reminder rule can hang off, via the same polymorphic
 * `(bearerType, bearerId)` pair milestones/taggings/mentions use. Adding one is
 * a Zod-only change — the column is free text.
 *
 * Note the second entry is **`observance`**, not `holiday`, though earlier
 * comments here and on migration 21 anticipated the latter. The rule bears on
 * the observance — the (person, holiday) pair — because that is what makes a
 * per-person schedule expressible: "gift Alice 30 days before Christmas" but
 * "just call Grandma day-of". Hanging it off the holiday would need a third
 * column naming the person, plus a parallel copy of the schedule machinery
 * (`@leapsake/holidays` README, the three layers).
 */
export const reminderRuleBearerTypeSchema = z.enum(["milestone", "observance"]);

export type ReminderRuleBearerType = z.infer<
  typeof reminderRuleBearerTypeSchema
>;

/**
 * A reminder rule — one entry in a bearer's staggered-reminder schedule: an
 * {@link ReminderAction} to take `offsetDays` days before the bearer's
 * occurrence (0 = day-of), on or off. A milestone with **no** rule rows rides
 * its kind's defaults (see `resolveReminderSchedule`); rows are written only
 * once the user customises the schedule.
 *
 * Deliberately **plaintext** (no per-item content key), consistent with
 * reminders themselves: reminder policy is scheduling
 * metadata, not a share target, and is covered by whole-DB-at-rest + the
 * master-key sync seal.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client UUID id,
 * epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via whole-row
 * LWW. Kept a plain `z.object` (no `.refine`) so the entity repo can derive its
 * columns from `.shape`; the `other`-requires-a-label rule lives on the input
 * schema below.
 */
export const reminderRuleSchema = z.object({
  id: z.uuid(),
  bearerType: reminderRuleBearerTypeSchema,
  bearerId: z.uuid(),
  action: reminderActionSchema,
  /** Free-text label; carries the user's text when `action === "other"`, else null. */
  label: z.string().nullable(),
  /** Lead days before the occurrence; 0 = day-of. */
  offsetDays: z.number().int().min(0),
  enabled: z.boolean(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type ReminderRule = z.infer<typeof reminderRuleSchema>;

/**
 * One row the schedule editor emits when saving — an action, its lead time,
 * whether it's on, and (for `other`) its free-text label. The repo mints the
 * id + timestamps and the bearer is supplied by the caller. `other` requires a
 * non-empty label (mirrors the `other` milestone kind requiring a note).
 *
 * ⚠️ Note the asymmetry between the check and the type. The runtime check
 * rejects `plan`; the inferred `action` type stays the full
 * {@link ReminderAction} union, because {@link SCHEDULABLE_ACTIONS} is typed as
 * an array *of* that union. That is deliberate, and it is what lets the engine
 * hand its synthesized prompt rule — a `plan`, which is not user input and is
 * never parsed — through the same shape the resolver returns, instead of
 * splitting one schedule into two types everything downstream would have to
 * discriminate.
 */
export const reminderRuleInputSchema = z
  .object({
    // The schedulable set, not the full enum: a `plan` rule is never stored (see
    // {@link SCHEDULABLE_ACTIONS}). The stored-row schema above stays on the
    // full enum deliberately — narrowing it there would make a peer's row fail
    // to parse, which is a sync failure rather than a validation one.
    action: z.enum(SCHEDULABLE_ACTIONS),
    label: z.string().nullable().optional(),
    offsetDays: z.number().int().min(0),
    enabled: z.boolean(),
  })
  .refine((r) => r.action !== "other" || (r.label ?? "").trim().length > 0, {
    message: "an 'other' reminder needs a label",
    path: ["label"],
  });

export type ReminderRuleInput = z.infer<typeof reminderRuleInputSchema>;

/**
 * The display label for a reminder rule: the action's registry label, except
 * `other`, which uses its free-text `label` (falling back to "Other" when
 * blank). Direct analogue of `milestoneLabel`.
 */
export function reminderRuleLabel(rule: {
  action: ReminderAction;
  label: string | null;
}): string {
  if (rule.action === "other") return rule.label ?? actionDefs.other.label;
  return actionDefs[rule.action].label;
}
