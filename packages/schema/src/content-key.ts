import { z } from "zod";

/**
 * Records that an entity has a content key; the key itself exists only as
 * `key_wrap` ciphertext. `entityType` is an open string.
 */
export const contentKeySchema = z.object({
  id: z.uuid(),
  entityType: z.string().min(1),
  entityId: z.uuid(),
  blobRef: z.string().nullable(), // object-storage pointer; null for in-DB items
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type ContentKey = z.infer<typeof contentKeySchema>;

/** Input accepted when registering a content key; the repo fills the rest. */
export const createContentKeyInputSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.uuid(),
  blobRef: z.string().nullable().optional(),
});

export type CreateContentKeyInput = z.infer<typeof createContentKeyInputSchema>;
