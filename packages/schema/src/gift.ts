import { z } from "zod";
import {
  giftOccasionSchema,
  giftOccasionTypeSchema,
  giftPartyTypeSchema,
  giftTargetDateSchema,
} from "./gift-suggestion.js";
import { formatMilestoneDate } from "./milestone.js";

/** A gift party — a person/pet on either end of a giving (giver or recipient). */
export const giftPartySchema = z.object({
  type: giftPartyTypeSchema,
  id: z.uuid(),
});

export type GiftParty = z.infer<typeof giftPartySchema>;

/**
 * The **what-happened** partial date of a giving ("Christmas 1941", "sometime in
 * 2023"). Reuses the milestone partial-date shape (`year`/`month`/`day`
 * individually nullable, the tested **day ⇒ month** rule, precision derived).
 * Plain `year`/`month`/`day` — a gift records *what happened*, distinct from a
 * suggestion's `target_*` *intent*.
 */
export const giftDateSchema = z
  .object({
    year: z.number().int().nullable().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    day: z.number().int().min(1).max(31).nullable().optional(),
  })
  .refine((d) => (d.day ?? null) === null || (d.month ?? null) !== null, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  });

export type GiftDate = z.infer<typeof giftDateSchema>;

/**
 * How the create surface names the idea a giving is of: an **existing** idea by
 * id, or a **new** one to mint in the same transaction ("logging
 * 'I gave Ralphie a BB gun' mints the idea and the gift in one transaction if 'BB
 * gun' doesn't exist yet"). A share-from-the-web giving may arrive URL-first, so
 * the new-idea arm accepts an optional url too.
 */
export const giftIdeaRefSchema = z.union([
  z.object({ id: z.uuid() }),
  z.object({
    title: z.string().min(1),
    url: z.string().min(1).nullable().optional(),
  }),
]);

export type GiftIdeaRef = z.infer<typeof giftIdeaRefSchema>;

/**
 * A Gift — a **dated event**: something changed hands. "Ralphie
 * was given a Red Ryder BB Gun, Christmas 1941." Distinct from an idea (the
 * *thing*) and a suggestion (a *candidate*): a giving is a fact with a date and a
 * second party. A giving points at the **idea**, never the suggestion, so "✓
 * given" renders as a query on `(gift_idea_id, recipient)` with no state column to
 * keep in sync, and the scotch you give your dad every Christmas is one suggestion
 * and **N** gifts.
 *
 * - {@link giftIdeaId} is **required** — a gift always has an idea.
 * - The giver `(giverType, giverId)` is **nullable** and means "unknown who gave
 *   it" when absent — *not* "me". "I gave it" is the giver pointing at the
 *   **self-person** (a real Person), avoiding the sentinel-leaks-everywhere trap
 *   of null-as-me.
 * - The recipient `(recipientType, recipientId)` is **required**.
 * - Plain `year`/`month`/`day` (what happened) and an optional occasion pointer
 *   (`milestone | holiday`), both on the same reused shapes as the suggestion.
 *
 * Sync-safe conventions (see AGENTS.md): client UUID id, epoch-ms UTC timestamps,
 * nullable `deletedAt`. Plaintext, like the other gift rows.
 */
export const giftSchema = z
  .object({
    id: z.uuid(),
    giftIdeaId: z.uuid(),
    giverType: giftPartyTypeSchema.nullable(),
    giverId: z.uuid().nullable(),
    recipientType: giftPartyTypeSchema,
    recipientId: z.uuid(),
    year: z.number().int().nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    day: z.number().int().min(1).max(31).nullable(),
    occasionType: giftOccasionTypeSchema.nullable(),
    occasionId: z.uuid().nullable(),
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((g) => g.day === null || g.month !== null, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  })
  .refine((g) => (g.occasionType === null) === (g.occasionId === null), {
    message: "occasion needs both a type and an id, or neither",
    path: ["occasionId"],
  })
  .refine((g) => (g.giverType === null) === (g.giverId === null), {
    message: "giver needs both a type and an id, or neither",
    path: ["giverId"],
  })
  .refine(
    (g) =>
      g.giverId === null ||
      !(g.giverType === g.recipientType && g.giverId === g.recipientId),
    { message: "a giver can't be the recipient", path: ["giverId"] },
  );

export type Gift = z.infer<typeof giftSchema>;

/**
 * The fields accepted when logging a giving (the single-payload create
 * surface). `giftIdea` mints a new idea when it isn't an existing id. `giver` is
 * omitted for "unknown", or points at the self-person for "I gave it".
 */
export const createGiftInputSchema = z.object({
  giftIdea: giftIdeaRefSchema,
  recipient: giftPartySchema,
  giver: giftPartySchema.nullable().optional(),
  date: giftDateSchema.optional(),
  occasion: giftOccasionSchema.nullable().optional(),
});

export type CreateGiftInput = z.infer<typeof createGiftInputSchema>;

/**
 * The repo-level create input, after core has resolved {@link giftIdeaRefSchema}
 * to a concrete `giftIdeaId` (minting the idea in the same transaction when new).
 */
export const createGiftRowInputSchema = z.object({
  giftIdeaId: z.uuid(),
  recipient: giftPartySchema,
  giver: giftPartySchema.nullable().optional(),
  date: giftDateSchema.optional(),
  occasion: giftOccasionSchema.nullable().optional(),
});

export type CreateGiftRowInput = z.infer<typeof createGiftRowInputSchema>;

/** Editable bits of a giving: giver, what-happened date, occasion — each settable
 *  or clearable to null. The idea and recipient are a giving's identity and don't
 *  change (log a new one instead). */
export const updateGiftInputSchema = z.object({
  giver: giftPartySchema.nullable().optional(),
  date: giftDateSchema.nullable().optional(),
  occasion: giftOccasionSchema.nullable().optional(),
});

export type UpdateGiftInput = z.infer<typeof updateGiftInputSchema>;

/** One giving in a {@link captureGiftInputSchema} payload: a what-happened date
 *  and/or an occasion. Each entry becomes one {@link Gift} per recipient. */
export const giftGivingEntrySchema = z.object({
  date: giftDateSchema.optional(),
  occasion: giftOccasionSchema.nullable().optional(),
});

export type GiftGivingEntry = z.infer<typeof giftGivingEntrySchema>;

/**
 * What a recipient's **suggestion** arm carries when it has no givings: the
 * occasion it's for and the target date it's aimed at ("for Christmas 2026",
 * "before her trip on the 3rd", "someday"). The mirror of a
 * {@link giftGivingEntrySchema}'s adornments, one arm over.
 */
export const captureSuggestionSchema = z.object({
  occasion: giftOccasionSchema.nullable().optional(),
  targetDate: giftTargetDateSchema.nullable().optional(),
});

export type CaptureSuggestion = z.infer<typeof captureSuggestionSchema>;

/**
 * One recipient in a {@link captureGiftInputSchema} payload, with **its own**
 * givings — givings are per-recipient (you gave Alice one on Christmas and Bob one
 * on his birthday), never shared across the whole payload. No givings ⇒ a
 * suggestion for this recipient; one-or-more ⇒ a gift each.
 *
 * The two arms carry their adornments separately and neither is shared: with
 * givings, each giving names its own date + occasion; without, {@link suggestion}
 * names the target date + occasion of the candidate. Givings win — a recipient
 * that has both is that many gifts, and `suggestion` is ignored, since a giving
 * is a fact and a suggestion is only a candidate for one.
 */
export const captureRecipientSchema = z.object({
  party: giftPartySchema,
  givings: z.array(giftGivingEntrySchema).optional(),
  suggestion: captureSuggestionSchema.optional(),
});

export type CaptureRecipient = z.infer<typeof captureRecipientSchema>;

/**
 * The **one consolidated create** surface:
 * an idea (existing or new) captured with zero-to-many recipients, each with its
 * own zero-to-many givings, in one transaction. It expresses the whole "type a
 * gift → suggest it → log it" flow as data:
 *
 * - **no recipients** → just the {@link GiftIdea} (typing a name on the Gifts
 *   screen).
 * - **a recipient with no givings** → one {@link GiftSuggestion} (a candidate —
 *   "would like this").
 * - **a recipient with giving(s)** → one {@link Gift} per giving (it happened, on
 *   these dates / occasions) — for *that* recipient only.
 *
 * `giver` defaults to the self-person downstream ("I gave it") when omitted.
 */
export const captureGiftInputSchema = z.object({
  giftIdea: giftIdeaRefSchema,
  recipients: z.array(captureRecipientSchema),
  giver: giftPartySchema.nullable().optional(),
});

export type CaptureGiftInput = z.infer<typeof captureGiftInputSchema>;

/**
 * A locale- and precision-aware rendering of a gift's what-happened date — the
 * same output as {@link formatMilestoneDate} (its columns are already `year`/
 * `month`/`day`), aliased for discoverability at gift call sites.
 */
export function formatGiftDate(g: {
  year: number | null;
  month: number | null;
  day: number | null;
}): string {
  return formatMilestoneDate(g);
}
