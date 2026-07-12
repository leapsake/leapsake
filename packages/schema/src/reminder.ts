import { z } from "zod";
import type { Tag } from "./tag.js";

/**
 * Where a reminder came from. `user` is everything today — hand-created by the
 * person using the app. `system` is reserved for the future automated increment
 * (upcoming birthdays/holidays, Leapsake-defined tasks) so that machinery needs
 * no schema change; stored as free text, constrained here like `milestoneKind`.
 */
export const reminderSourceSchema = z.enum(["user", "system"]);

export type ReminderSource = z.infer<typeof reminderSourceSchema>;

/**
 * A Reminder — a freeform note/task the user keeps to stay on top of things, and
 * the intended heart of the future home screen. Both {@link title} and
 * {@link body} are optional free text, but **at least one must be present**.
 * {@link completedAt} is null until the user marks it done and is cleared when
 * they un-do it (a reversible toggle, not a one-way action).
 *
 * `#tags` are parsed **inline** from the text (see {@link parseHashtags}) and
 * stored as ordinary taggings under bearer type `"reminder"` — the reminder text
 * is the single source of truth for its tags. `@mentions` of People/Pets are a
 * later increment (a distinct `mentions` relationship pointing at an entity id,
 * *not* a tagging).
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client UUID id,
 * epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via whole-row LWW.
 * Deliberately plaintext (no per-item content key): reminders aren't a share
 * target, and whole-DB-at-rest + master-key-sealed sync already protect them.
 */
export const reminderSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).nullable(),
    body: z.string().min(1).nullable(),
    completedAt: z.number().int().nullable(), // epoch ms, UTC; null = open
    dueDate: z.number().int().nullable(), // epoch-ms UTC midnight of the civil due day; null = no due date
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

/**
 * A reminder joined with the tags parsed from its text — each carrying the id the
 * tag was resolved/created under, so a renderer can link an inline `#tag` (see
 * {@link splitHashtags}) to its tag page. Core populates this on reads; the text
 * remains the single source of truth for *which* tags exist.
 */
export type ReminderWithTags = Reminder & { tags: Tag[] };

/** The optional text fields shared by create/update inputs. */
const textShape = {
  title: z.string().min(1).nullable().optional(),
  body: z.string().min(1).nullable().optional(),
};

/** At least one of title/body must be present (treating absent as null). */
function hasTitleOrBody(r: { title?: string | null; body?: string | null }) {
  return (r.title ?? null) !== null || (r.body ?? null) !== null;
}

/** The fields accepted when creating a reminder (`source` defaults to `user`). */
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
 * Editable fields when updating a reminder: the text and the completion stamp.
 * The repository merges this onto the stored row and re-validates the whole row,
 * so the title-or-body rule still holds after a partial update.
 */
export const updateReminderInputSchema = z.object({
  ...textShape,
  dueDate: z.number().int().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
});

export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

/**
 * The display label for a reminder: its title, else the first line of its body,
 * else a placeholder (the schema guarantees at least one of title/body, so the
 * placeholder is only a type-level fallback).
 */
export function reminderLabel(r: {
  title: string | null;
  body: string | null;
}): string {
  if (r.title !== null) return r.title;
  if (r.body !== null) return r.body.split("\n")[0];
  return "Untitled reminder";
}
