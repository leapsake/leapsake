import { z } from "zod";

/** What a gift idea can be for. */
export const giftPartyTypeSchema = z.enum(["person", "pet"]);

export type GiftPartyType = z.infer<typeof giftPartyTypeSchema>;

/** A person or pet a gift idea is attached to. */
export const giftPartySchema = z.object({
  type: giftPartyTypeSchema,
  id: z.uuid(),
});

export type GiftParty = z.infer<typeof giftPartySchema>;

/**
 * The idea a write attaches a party to: an existing one by id, or a new one to
 * create in the same transaction.
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
 * A gift idea paired with a person or pet, and whether it has been given. Not
 * unique per pair: two devices may each create one, and reads dedupe.
 */
export const giftRecipientSchema = z.object({
  id: z.uuid(),
  giftIdeaId: z.uuid(),
  recipientType: giftPartyTypeSchema,
  recipientId: z.uuid(),
  /**
   * When "given" was ticked, not when the gift changed hands. Reads treat it as
   * a boolean; it is never shown.
   */
  givenAt: z.number().int().nullable(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type GiftRecipient = z.infer<typeof giftRecipientSchema>;

/**
 * One party in a write, and whether it has been given; the repo turns `given`
 * into the `givenAt` stamp.
 */
export const giftRecipientEntrySchema = z.object({
  party: giftPartySchema,
  given: z.boolean().optional(), // absent ⇒ not given
});

export type GiftRecipientEntry = z.infer<typeof giftRecipientEntrySchema>;

/** The fields accepted when attaching a party to an existing idea. */
export const createGiftRecipientInputSchema = giftRecipientEntrySchema.extend({
  giftIdeaId: z.uuid(),
});

export type CreateGiftRecipientInput = z.infer<
  typeof createGiftRecipientInputSchema
>;

/** Only `given` is editable; the idea and recipient are the row's identity. */
export const updateGiftRecipientInputSchema = z.object({
  given: z.boolean(),
});

export type UpdateGiftRecipientInput = z.infer<
  typeof updateGiftRecipientInputSchema
>;

/** An idea, new or existing, and any number of recipients, written at once. */
export const captureGiftInputSchema = z.object({
  giftIdea: giftIdeaRefSchema,
  recipients: z.array(giftRecipientEntrySchema),
});

export type CaptureGiftInput = z.infer<typeof captureGiftInputSchema>;
