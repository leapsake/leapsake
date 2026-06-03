import { z } from "zod";

/**
 * A Person — the core entity. The full database row shape.
 *
 * Sync-safe conventions (see reboot-plan.md §4.2): client-generated UUID
 * primary key, epoch-ms UTC timestamps, and a nullable `deletedAt` for soft
 * deletes (rows are never hard-deleted, so deletions can propagate during V3
 * sync).
 */
export const personSchema = z.object({
  id: z.uuid(),
  firstName: z.string().min(1),
  middleName: z.string().min(1).nullable(), // optional; null when absent
  lastName: z.string().min(1),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Person = z.infer<typeof personSchema>;

/** Input accepted when creating a Person; the repository fills the rest. */
export const createPersonInputSchema = z.object({
  firstName: z.string().min(1),
  middleName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1),
});

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;

/** Input accepted when updating a Person; any subset of the editable fields. */
export const updatePersonInputSchema = createPersonInputSchema.partial();

export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
