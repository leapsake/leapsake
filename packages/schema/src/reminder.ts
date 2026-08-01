import { z } from "zod";
import { plainMentionText } from "./mention.js";
import type { ResolvedMention } from "./mentioning.js";
import type { Tag } from "./tag.js";

/**
 * Where a reminder came from. `user` is hand-created by the person using the app.
 * `system` is **engine-owned** — upcoming birthdays, per-milestone schedules,
 * holiday observances, and the onboarding nudges — and its text is re-derived on
 * every reconcile, which is why a `system` reminder isn't editable (completing and
 * deleting stay open; see {@link isReminderEditable}). Having the enum from the
 * start meant that automation needed no schema change, and Leapsake-defined tasks
 * will extend the same engine. Stored as free text, constrained here like
 * `milestoneKind`.
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
 * Both `#tags` and `@mentions` are parsed **inline** from the text — the reminder
 * text is the single source of truth for both. `#tags` (see {@link parseHashtags})
 * are stored as ordinary taggings under bearer type `"reminder"`. `@mentions` of
 * People/Pets (see {@link parseMentions}) are a *distinct* thing: an inline token
 * carrying the referenced entity's id, re-derived on write into synced, indexed
 * {@link Mentioning} rows (a relationship pointing at an entity id, **not** a
 * tagging — a mention names a specific pre-existing entity, never a shared label).
 *
 * {@link reminderSchema}'s `snoozedUntil`/`snoozeCount` are **snooze**: put this off,
 * ask me later. Generic to every reminder — the onboarding nudges are only the first
 * consumer, and `source` is what tells the two cases apart. They record *what
 * happened*, never what to do next; migration 28 is the authority on why that
 * distinction is load-bearing and how it can be broken by accident.
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
    snoozedUntil: z.number().int().nullable(), // epoch ms, UTC; null = not snoozed
    snoozeCount: z.number().int().nonnegative(), // how many times it has been put off
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
 * A reminder joined with the references derived from its text: the `#tags` (each
 * carrying the id its tag was resolved/created under, to link an inline `#tag` —
 * see {@link splitHashtags} — to its tag page) and the `@mentions` (each resolved
 * to its target entity's current label, to link an inline mention token to the
 * person/pet page). Core populates both on reads; the text remains the single
 * source of truth for *which* tags and mentions exist. (The name is historical —
 * it now carries mentions too.)
 */
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
 * Editable fields when updating a reminder: the text, the completion stamp, and
 * the snooze clock. The repository merges this onto the stored row and re-validates
 * the whole row, so the title-or-body rule still holds after a partial update.
 *
 * `snoozeCount` is **deliberately absent**. It is engine-owned — `remindersRepo.snooze`
 * is the only write that touches it, and it only ever increments, so a caller can
 * neither reset its own nag budget nor skip ahead. Only `snoozedUntil` is a
 * patchable field.
 */
export const updateReminderInputSchema = z.object({
  ...textShape,
  dueDate: z.number().int().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
  snoozedUntil: z.number().int().nullable().optional(),
});

export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

/**
 * The date a snooze runs to — epoch ms, UTC. The single authority on what a valid
 * `until` is, shared by the desktop IPC boundary and `remindersRepo.snooze` so the
 * two can't disagree.
 *
 * **Any date passes, deliberately.** Snooze is generic (see {@link reminderSchema}),
 * so the policy that picked this date — which reminders may be put off, and for how
 * long — belongs to the caller, not here; a reminder with no policy at all is the
 * ordinary case. A date already in the past is simply an inert snooze, which is the
 * right outcome for a badly-chosen “hide until Tuesday”. What this *does* stop is a
 * non-integer: the column is INTEGER but SQLite is loosely typed, so an unchecked
 * string would be stored happily and then fail row validation on every subsequent
 * read of that reminder.
 */
export const snoozeUntilSchema = z.number().int();

/**
 * The display label for a reminder as a **plain string**: its title, else the
 * first line of its body, else a placeholder (the schema guarantees at least one
 * of title/body, so the placeholder is only a type-level fallback). Inline
 * `@mention` tokens are stripped to their display names (see
 * {@link plainMentionText}) — this feeds the contexts that show raw text rather
 * than the `ReminderText` renderer (delete confirmations, list labels).
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
 * Whether a reminder's title/details are the user's to edit. Automatically
 * generated (`system`) reminders are derived from a milestone — the engine owns
 * their text and re-derives it on every reconcile — so only reminders the user
 * created are content-editable. This gates the *edit* affordance alone: a user can
 * still complete/reopen or delete an automatic reminder. (A future sub-reminder
 * would attach through its own path, not this content edit, so it stays unblocked.)
 */
export function isReminderEditable(r: { source: ReminderSource }): boolean {
  return r.source === "user";
}
