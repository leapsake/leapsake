import { z } from "zod";

/**
 * A thing that could be given, saying nothing about who wants it; a
 * {@link GiftRecipient} pairs it with someone. Similar titles are not merged.
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

/** The fields accepted when creating a gift idea; only a title is needed. */
export const createGiftIdeaInputSchema = z.object({
  title: z.string().min(1),
  ...optionalFields,
});

export type CreateGiftIdeaInput = z.infer<typeof createGiftIdeaInputSchema>;

/** Input accepted when updating a gift idea; any subset of its fields. */
export const updateGiftIdeaInputSchema = z.object({
  title: z.string().min(1).optional(),
  ...optionalFields,
});

export type UpdateGiftIdeaInput = z.infer<typeof updateGiftIdeaInputSchema>;
