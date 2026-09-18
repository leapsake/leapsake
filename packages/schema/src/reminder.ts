import { z } from "zod";
import { plainMentionText } from "./mention.js";
import type { ResolvedMention } from "./mentioning.js";
import type { Tag } from "./tag.js";

/** Who made a reminder: the user, or the engine, which owns its text. */
export const reminderSourceSchema = z.enum(["user", "system"]);

export type ReminderSource = z.infer<typeof reminderSourceSchema>;

/**
 * A note or task with a title, a body, or both. Its `#tags` and `@mentions` are
 * parsed from the text on every write; the text is their source of truth.
 */
export const reminderSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).nullable(),
    body: z.string().min(1).nullable(),
    completedAt: z.number().int().nullable(), // epoch ms, UTC; null = open
    dueDate: z.number().int().nullable(), // UTC midnight of the civil due day
    snoozedUntil: z.number().int().nullable(), // UTC midnight of the day it returns
    source: reminderSourceSchema,
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((r) => r.title !== null || r.body !== null, {
    message: "a reminder needs a title or a body",
    path: ["title"],
  });

export type Reminder = z.infer<typeof reminderSchema>;

/** A reminder with the tags and resolved mentions its text refers to. */
export type ReminderWithTags = Reminder & {
  tags: Tag[];
  mentions: ResolvedMention[];
};

/** The optional text fields shared by create/update inputs. */
const textShape = {
  title: z.string().min(1).nullable().optional(),
  body: z.string().min(1).nullable().optional(),
};

/** At least one of title/body must be present (treating absent as null). */
function hasTitleOrBody(r: { title?: string | null; body?: string | null }) {
  return (r.title ?? null) !== null || (r.body ?? null) !== null;
}

/** The fields accepted when creating a reminder; `source` defaults to user. */
export const createReminderInputSchema = z
  .object({
    ...textShape,
    dueDate: z.number().int().nullable().optional(),
    source: reminderSourceSchema.optional(),
  })
  .refine(hasTitleOrBody, {
    message: "a reminder needs a title or a body",
    path: ["title"],
  });

export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;

/**
 * A partial reminder update. The repo re-validates the merged row, so the
 * title-or-body rule still holds.
 */
export const updateReminderInputSchema = z.object({
  ...textShape,
  dueDate: z.number().int().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
  snoozedUntil: z.number().int().nullable().optional(),
});

export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

/**
 * The day a snooze runs to. Guards only the column's type; how far a row may be
 * put off is `snoozeTargetOf`'s call in @leapsake/reminders.
 */
export const snoozeUntilSchema = z.number().int();

/** The days "remind me in…" puts a row off for. */
export const snoozeDaysSchema = z.number().int().min(1);

/**
 * A reminder as one plain string: its title, else its body's first line, with
 * mention tokens shown as `@name`.
 */
export function reminderLabel(r: {
  title: string | null;
  body: string | null;
}): string {
  if (r.title !== null) return plainMentionText(r.title);
  if (r.body !== null) return plainMentionText(r.body.split("\n")[0]);
  return "Untitled reminder";
}

/**
 * Whether the user may edit a reminder's text: only their own. Any reminder can
 * still be completed, reopened, or deleted.
 */
export function isReminderEditable(r: { source: ReminderSource }): boolean {
  return r.source === "user";
}

/**
 * Whether someone decided something about this row since it was minted, so a
 * peer's fresh mint must not win the merge. A `user` row always has history.
 */
export function reminderHasHistory(r: Reminder): boolean {
  return (
    r.deletedAt !== null ||
    r.completedAt !== null ||
    r.snoozedUntil !== null ||
    r.source === "user"
  );
}
