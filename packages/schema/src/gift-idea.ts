import { z } from "zod";
import {
  type GiftOccasion,
  type GiftOccasionType,
  giftOccasionSchema,
  giftOccasionTypeSchema,
  giftTargetDateSchema,
} from "./gift-suggestion.js";

/**
 * A GiftIdea — "a thing in the world" (a Red Ryder BB Gun), reusable and
 * **person-agnostic**: it says nothing about who might want it. That's the
 * deliberate split at the heart of gifts: an idea is about the
 * *thing* (it can have a URL; a person can't), a {@link GiftSuggestion} pairs an
 * idea with a recipient, and a {@link Gift} is a dated giving. An idea can be
 * suggested for zero-to-many people and given zero-to-many times.
 *
 * {@link title} is the only required field; {@link url} (where to buy / read
 * more) and {@link notes} are optional free text. Near-duplicates ("BB gun" vs
 * "Red Ryder BB Gun") are **tolerated, not auto-merged** — titles are prose, and
 * the eventual answer is the existing reconciliation substrate, not silent
 * normalization here.
 *
 * Sync-safe conventions (see AGENTS.md): client-generated UUID primary key,
 * epoch-ms UTC timestamps, nullable `deletedAt` for soft deletes. Deliberately
 * plaintext (no per-item content key), like reminders — a gift idea isn't a share
 * target, and whole-DB-at-rest + master-key-sealed sync already protect it
 *.
 */
export const giftIdeaSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  url: z.string().min(1).nullable(), // optional; null when absent
  notes: z.string().min(1).nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type GiftIdea = z.infer<typeof giftIdeaSchema>;

/** The optional fields shared by create/update inputs. */
const optionalFields = {
  url: z.string().min(1).nullable().optional(),
  notes: z.string().min(1).nullable().optional(),
};

/**
 * The fields accepted when creating a gift idea. Only {@link title} is required;
 * the repository fills id/timestamps. (The single-payload create surface grows a
 * `suggestFor` arm, but that lives on the core method, not this row-input
 * schema.)
 */
export const createGiftIdeaInputSchema = z.object({
  title: z.string().min(1),
  ...optionalFields,
});

export type CreateGiftIdeaInput = z.infer<typeof createGiftIdeaInputSchema>;

/** Input accepted when updating a gift idea; any subset of the editable fields. */
export const updateGiftIdeaInputSchema = z.object({
  title: z.string().min(1).optional(),
  ...optionalFields,
});

export type UpdateGiftIdeaInput = z.infer<typeof updateGiftIdeaInputSchema>;

/**
 * A GiftIdeaOccasion — "this thing is a Christmas thing", said about the
 * {@link GiftIdea} itself rather than about anyone in particular. It is what lets
 * a gift be captured before a recipient exists: *"this would make a good
 * Christmas gift for someone"*, *"this is a great idea for someone's birthday"*.
 *
 * **Its own table, not columns on the idea**, because the cardinality is real: a
 * nice candle is a birthday gift *and* a Christmas gift *and* a housewarming
 * gift. A row per occasion also merges cleanly — two devices each adding one end
 * up with both, where a single column would silently drop one under whole-row
 * LWW.
 *
 * The pointer is the same {@link giftOccasionSchema} a suggestion carries, with
 * the `kind` arm actually in play: with no recipient there is no bearer to hang a
 * milestone on, so "someone's birthday" is stored as the kind. Suggest the idea
 * for a real person later and core resolves it against them.
 *
 * `target_*` mirrors a suggestion's intent date ("Christmas *2026*"), reusing the
 * milestone day⇒month rule. Sync-safe conventions as everywhere else (see
 * AGENTS.md); plaintext, like the other gift rows.
 */
export const giftIdeaOccasionSchema = z
  .object({
    id: z.uuid(),
    giftIdeaId: z.uuid(),
    // Both parts are NOT NULL here: the row *is* the occasion, so an occasionless
    // one is not a state — it is a row that shouldn't exist.
    occasionType: giftOccasionTypeSchema,
    occasionId: z.string().min(1),
    targetYear: z.number().int().nullable(),
    targetMonth: z.number().int().min(1).max(12).nullable(),
    targetDay: z.number().int().min(1).max(31).nullable(),
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((o) => giftOccasionSchema.safeParse(occasionOf(o)).success, {
    message: "a milestone/holiday occasion needs a uuid, a kind needs a kind",
    path: ["occasionId"],
  })
  .refine((o) => o.targetDay === null || o.targetMonth !== null, {
    message: "a target day requires a target month",
    path: ["targetDay"],
  });

export type GiftIdeaOccasion = z.infer<typeof giftIdeaOccasionSchema>;

/** The flat row's pointer as the nested {@link GiftOccasion} the forms speak. */
export function occasionOf(row: {
  occasionType: GiftOccasionType;
  occasionId: string;
}): GiftOccasion {
  return { type: row.occasionType, id: row.occasionId };
}

/**
 * One occasion in a set-replace of an idea's occasions. Identity is the
 * **pointer**, not a row id: the caller says which occasions the idea has, and
 * core keeps the rows that survive (so a target-date edit is an update, not a
 * delete-and-recreate that would churn sync).
 */
export const giftIdeaOccasionInputSchema = z.object({
  occasion: giftOccasionSchema,
  targetDate: giftTargetDateSchema.nullable().optional(),
});

export type GiftIdeaOccasionInput = z.infer<typeof giftIdeaOccasionInputSchema>;
