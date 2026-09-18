import { z } from "zod";

/**
 * The namespace the self-person row's id is derived under, so every device
 * mints the same row for "you". Never change it.
 */
export const SELF_PERSON_NAMESPACE = "leapsake:self-person";

/** The name the one self-person row's id is derived from. */
export const SELF_PERSON_ID_NAME = "singleton";

/**
 * A synced pointer to the ordinary {@link Person} who is "you". A soft-deleted
 * row means unset.
 */
export const selfPersonSchema = z.object({
  id: z.uuid(), // always the constant SELF_PERSON_ID, minted by the repo
  personId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type SelfPerson = z.infer<typeof selfPersonSchema>;

/** Who "you" are: an existing person's id. The repo upserts the one row. */
export const setSelfInputSchema = z.object({ personId: z.uuid() });

export type SetSelfInput = z.infer<typeof setSelfInputSchema>;
