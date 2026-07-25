import { z } from "zod";

/**
 * The closed set of reminder **actions** — the "what to do" of a staggered
 * reminder (get a gift, send a card, give a call…). A starter set; adding an
 * action later is one enum line plus an `actionDefs` entry, never a migration
 * (the DB stores the action as free text, constrained here in Zod). Insertion
 * order is the UI listing order. `other` is the escape hatch and leans on the
 * per-rule free-text `label`, exactly like the `other` milestone kind leans on
 * its `note`.
 */
export const reminderActionSchema = z.enum([
  "wish",
  "gift",
  "card",
  "call",
  "text",
  "visit",
  "remember",
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
}

/** Static metadata for a reminder action: how it displays and its default copy. */
export interface ReminderActionDef {
  /** Display label, e.g. "Get a gift". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
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
    // The one action whose copy turns on the occasion. With a birthday's
    // greeting this renders exactly the string the birthday-only engine used to
    // hard-code, which is what keeps existing reminders from drifting on
    // upgrade; with a holiday's it reads "Wish @Alice a Merry Christmas".
    template: ({ subject, greeting }) => `Wish ${subject} ${greeting}`,
  },
  gift: {
    label: "Get a gift",
    icon: "🎁",
    template: ({ subject }) => `Get ${subject} a gift`,
  },
  card: {
    label: "Send a card",
    icon: "💌",
    template: ({ subject }) => `Send ${subject} a card`,
  },
  call: {
    label: "Give a call",
    icon: "📞",
    template: ({ subject }) => `Call ${subject}`,
  },
  text: {
    label: "Send a text",
    icon: "💬",
    template: ({ subject }) => `Text ${subject}`,
  },
  visit: {
    label: "Visit",
    icon: "🏡",
    template: ({ subject }) => `Visit ${subject}`,
  },
  remember: {
    label: "Remember them",
    icon: "🕯️",
    template: ({ subject }) => `Remember ${subject}`,
  },
  other: {
    label: "Other",
    icon: "🔔",
    // No fixed copy — the rule's free-text `label` is the reminder text.
    template: () => actionDefs.other.label,
  },
};

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
 * (holidays/research.md §1).
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
 */
export const reminderRuleInputSchema = z
  .object({
    action: reminderActionSchema,
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
