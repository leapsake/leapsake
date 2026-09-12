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
 * {@link reminderSchema}'s `snoozedUntil` is **snooze**: put this off, remind me
 * later — generic to every reminder, whatever made it. It records *what happened*
 * (the day the user chose), never what to do next; migration 28 is the authority on
 * why that distinction is load-bearing, and migration 37 on why the count that once
 * sat beside it is gone.
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
    snoozedUntil: z.number().int().nullable(), // epoch-ms UTC midnight of the civil day the snooze ends; null = not snoozed
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
 */
export const updateReminderInputSchema = z.object({
  ...textShape,
  dueDate: z.number().int().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
  snoozedUntil: z.number().int().nullable().optional(),
});

export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

/**
 * The day a snooze runs to, as `remindersRepo.snooze` stores it — epoch-ms UTC
 * midnight of a civil day, like a due date.
 *
 * **Any integer passes here, deliberately.** Which rows may be put off, and how
 * far, is `@leapsake/reminders`' `snoozeTargetOf`, which the one caller consults
 * first; this only guards the column. That matters because the column is INTEGER
 * but SQLite is loosely typed, so an unchecked string would be stored happily and
 * then fail row validation on every subsequent read of that reminder.
 */
export const snoozeUntilSchema = z.number().int();

/**
 * How many days "remind me in…" puts a row off for — a whole number, at least one.
 * The shape the desktop IPC boundary checks a snooze request against, so a
 * renderer can ask for a day count and nothing else; whether *this* row may be put
 * off that far is decided behind it, by `snoozeTargetOf`.
 */
export const snoozeDaysSchema = z.number().int().min(1);

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

/**
 * Whether anything has happened to this reminder since the engine minted it —
 * the {@link HasHistory} predicate `reminders` merges with, and the reason a
 * peer's fresh mint can no longer undo a dismissal or reset a snooze across
 * sync (`packages/reminders/README.md` → *Merge safety*; `merge.ts` for the rule).
 *
 * History is a **decision someone took about this row**: putting it off
 * (`snoozedUntil`), finishing it (`completedAt`), or dismissing it (`deletedAt` — including the engine's own
 * retirement, which is equally irreplaceable since it records a signal the peer
 * has not seen). A `user` row is history by construction: nothing minted it. The
 * check is inert there in practice — user reminders get random UUIDs, so two
 * devices never mint the same one — but the predicate has to mean what it says.
 *
 * What is deliberately **not** history: `title` and `dueDate`. The engine
 * re-derives both on every reconcile, so a row whose title has drifted is still
 * a row nobody has decided anything about, and it should still lose to a peer's
 * snooze. That precision is the reason this is a per-table predicate rather than
 * a timestamp test in the merge — no comparison of `createdAt` and `updatedAt`
 * can tell an engine refresh from a user's act.
 */
export function reminderHasHistory(r: Reminder): boolean {
  return (
    r.deletedAt !== null ||
    r.completedAt !== null ||
    r.snoozedUntil !== null ||
    r.source === "user"
  );
}
