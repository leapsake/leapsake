import { z } from "zod";
import { formatMilestoneDate } from "./milestone.js";

/**
 * The party a gift is suggested for (and, in a {@link Gift}, given by / to). Its
 * own enum per the house convention that each concern owns its bearer enum (see
 * `tagging.ts`). `relationship` is a plausible fourth party later ("we gave the
 * Smiths a wedding present") — one line here, no migration, exactly as
 * {@link milestoneBearerTypeSchema} reserved room.
 */
export const giftPartyTypeSchema = z.enum(["person", "pet"]);

export type GiftPartyType = z.infer<typeof giftPartyTypeSchema>;

/**
 * What a gift's **occasion** points at — a milestone or a holiday. A third type
 * is one line later. The occasion is a *label*, not the source
 * of truth for *when*: it references the **holiday** (never an observance) or the
 * milestone, and the target date + person resolve the actual occurrence — a
 * holiday reference alone is ambiguous (a lunisolar holiday can fall twice in one
 * Gregorian year, which is why the engine keys occurrences on date).
 */
export const giftOccasionTypeSchema = z.enum(["milestone", "holiday"]);

export type GiftOccasionType = z.infer<typeof giftOccasionTypeSchema>;

/** A complete occasion pointer — both parts present, or the whole thing absent. */
export const giftOccasionSchema = z.object({
  type: giftOccasionTypeSchema,
  id: z.uuid(),
});

export type GiftOccasion = z.infer<typeof giftOccasionSchema>;

/**
 * The **target partial date** of a suggestion — *intent* ("for Christmas 2026",
 * "before her trip on the 3rd", "someday"). Reuses the milestone partial-date
 * shape: `year`/`month`/`day` individually nullable with the tested **day ⇒
 * month** rule, precision *derived* (never stored). Distinct column names on the
 * row (`target_*`) keep intent from blurring with a gift's *what-happened* date.
 */
export const giftTargetDateSchema = z
  .object({
    year: z.number().int().nullable().optional(),
    month: z.number().int().min(1).max(12).nullable().optional(),
    day: z.number().int().min(1).max(31).nullable().optional(),
  })
  .refine((d) => (d.day ?? null) === null || (d.month ?? null) !== null, {
    message: "a day requires a month (no lone day, no year+day)",
    path: ["day"],
  });

export type GiftTargetDate = z.infer<typeof giftTargetDateSchema>;

/**
 * A GiftSuggestion — a **candidate**: one {@link GiftIdea} paired with a
 * recipient. "Ralphie would like a Red Ryder BB Gun." Distinct
 * from the idea (about the *thing*) and from a {@link Gift} (a dated event); a
 * suggestion is a set membership, and its cardinality differs from a giving's —
 * the scotch you give your dad every Christmas is **one** suggestion and N
 * givings, which is why a suggestion carries no state and no "given" column: that
 * is a query over gifts, not a mutation here.
 *
 * **No note, no state, no giver** in v1 — a suggestion almost always originates
 * with the user, so the giver is implicit, and it stays a bare-ish join by
 * design (a note is easy to add later). The optional {@link occasionType}/
 * {@link occasionId} pointer and `target_*` partial date are the only adornments.
 *
 * Sync-safe conventions (see AGENTS.md): client UUID id, epoch-ms UTC timestamps,
 * nullable `deletedAt`. Plaintext, like the other gift rows.
 */
export const giftSuggestionSchema = z
  .object({
    id: z.uuid(),
    giftIdeaId: z.uuid(),
    recipientType: giftPartyTypeSchema,
    recipientId: z.uuid(),
    // Occasion: a complete pointer or nothing — both parts move together.
    occasionType: giftOccasionTypeSchema.nullable(),
    occasionId: z.uuid().nullable(),
    targetYear: z.number().int().nullable(),
    targetMonth: z.number().int().min(1).max(12).nullable(),
    targetDay: z.number().int().min(1).max(31).nullable(),
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(),
    deletedAt: z.number().int().nullable(),
  })
  .refine((s) => s.targetDay === null || s.targetMonth !== null, {
    message: "a target day requires a target month",
    path: ["targetDay"],
  })
  .refine((s) => (s.occasionType === null) === (s.occasionId === null), {
    message: "occasion needs both a type and an id, or neither",
    path: ["occasionId"],
  });

export type GiftSuggestion = z.infer<typeof giftSuggestionSchema>;

/**
 * One recipient-and-adornments entry — the shape shared by a standalone create
 * and by an arm of the idea's `suggestFor` single-payload create.
 * `giftIdeaId` is supplied by the enclosing create (the idea being suggested), so
 * it isn't repeated here.
 */
export const suggestForEntrySchema = z.object({
  recipientType: giftPartyTypeSchema,
  recipientId: z.uuid(),
  occasion: giftOccasionSchema.nullable().optional(),
  targetDate: giftTargetDateSchema.nullable().optional(),
});

export type SuggestForEntry = z.infer<typeof suggestForEntrySchema>;

/** The fields accepted when creating a suggestion directly (idea already exists). */
export const createGiftSuggestionInputSchema = suggestForEntrySchema.extend({
  giftIdeaId: z.uuid(),
});

export type CreateGiftSuggestionInput = z.infer<
  typeof createGiftSuggestionInputSchema
>;

/** Editable bits of a suggestion: its occasion and target date (both optional). */
export const updateGiftSuggestionInputSchema = z.object({
  occasion: giftOccasionSchema.nullable().optional(),
  targetDate: giftTargetDateSchema.nullable().optional(),
});

export type UpdateGiftSuggestionInput = z.infer<
  typeof updateGiftSuggestionInputSchema
>;

/**
 * A locale- and precision-aware rendering of a suggestion's target date — the
 * same output as {@link formatMilestoneDate} ("March 9, 1992", "March 1992",
 * "1992", "March 9", or "" when unset), mapping the `target_*` parts onto the
 * shared formatter so the two never drift.
 */
export function formatGiftTargetDate(s: {
  targetYear: number | null;
  targetMonth: number | null;
  targetDay: number | null;
}): string {
  return formatMilestoneDate({
    year: s.targetYear,
    month: s.targetMonth,
    day: s.targetDay,
  });
}
