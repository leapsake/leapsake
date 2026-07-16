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

/** Static metadata for a reminder action: how it displays and its default copy. */
export interface ReminderActionDef {
  /** Display label, e.g. "Get a gift". */
  label: string;
  /** Optional emoji shown beside the label. */
  icon?: string;
  /**
   * The reminder copy this action produces for a bearer, e.g.
   * `` (name) => `Get ${name} a gift` ``. Reserved for the **next** increment,
   * where the engine turns an enabled rule into a `system` reminder title;
   * unused by this increment's storage/editing surface. `other` has no fixed
   * template — its copy is the rule's free-text {@link ReminderRule.label}
   * (see {@link reminderRuleLabel}) — so it falls back to its plain label.
   */
  template: (bearerLabel: string) => string;
}

/**
 * The reminder-action registry, parallel to `kindDefs`. Insertion order matches
 * {@link reminderActionSchema} and is the UI listing order.
 */
export const actionDefs: Record<ReminderAction, ReminderActionDef> = {
  wish: {
    label: "Wish them",
    icon: "🎉",
    // Birthday-centric copy (its default home); the engine can specialise the
    // greeting per kind/holiday in the wiring increment.
    template: (name) => `Wish ${name} a happy birthday`,
  },
  gift: {
    label: "Get a gift",
    icon: "🎁",
    template: (name) => `Get ${name} a gift`,
  },
  card: {
    label: "Send a card",
    icon: "💌",
    template: (name) => `Send ${name} a card`,
  },
  call: {
    label: "Give a call",
    icon: "📞",
    template: (name) => `Call ${name}`,
  },
  text: {
    label: "Send a text",
    icon: "💬",
    template: (name) => `Text ${name}`,
  },
  visit: {
    label: "Visit",
    icon: "🏡",
    template: (name) => `Visit ${name}`,
  },
  remember: {
    label: "Remember them",
    icon: "🕯️",
    template: (name) => `Remember ${name}`,
  },
  other: {
    label: "Other",
    icon: "🔔",
    // No fixed copy — the rule's free-text `label` is the reminder text.
    template: () => actionDefs.other.label,
  },
};

/**
 * The bearer types a reminder rule can hang off. `milestone` today; the
 * polymorphic `(bearerType, bearerId)` pair lets `holiday` join later with no
 * schema change — the same reason milestones/taggings/mentions use a bearer
 * pair. This increment only ever writes `"milestone"`.
 */
export const reminderRuleBearerTypeSchema = z.enum(["milestone"]);

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
 * reminders themselves (plans/reminders.md): reminder policy is scheduling
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
