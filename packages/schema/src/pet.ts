import { z } from "zod";

/**
 * A Pet — an entity that joins the relationship graph alongside Person. The
 * full database row shape.
 *
 * Same sync-safe conventions as Person (see reboot-plan.md §4.2): client-
 * generated UUID primary key, epoch-ms UTC timestamps, and a nullable
 * `deletedAt` for soft deletes (rows are never hard-deleted, so deletions can
 * propagate during V3 sync).
 */
export const petSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Pet = z.infer<typeof petSchema>;

/** Input accepted when creating a Pet; the repository fills the rest. */
export const createPetInputSchema = z.object({
  name: z.string().min(1),
});

export type CreatePetInput = z.infer<typeof createPetInputSchema>;

/** Input accepted when updating a Pet; any subset of the editable fields. */
export const updatePetInputSchema = createPetInputSchema.partial();

export type UpdatePetInput = z.infer<typeof updatePetInputSchema>;
