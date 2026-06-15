import { z } from "zod";

/**
 * A `content_key` row (encryption-schema.md §2.3): the per-item key *registry*.
 * One row per shareable unit records that an entity has a content key and which
 * item it protects — never the key bytes themselves, which live only as
 * `key_wrap` ciphertext.
 *
 * Same sync-safe conventions as the domain tables (reboot-plan.md §4.2):
 * client-generated UUID PK, epoch-ms UTC timestamps, nullable `deletedAt` soft
 * delete. `entityType` is left an open string (not an enum) because the set
 * grows freely — 'person', 'pet', 'photo_album', 'share_bundle', … — without a
 * schema change.
 */
export const contentKeySchema = z.object({
  id: z.uuid(),
  entityType: z.string().min(1),
  entityId: z.uuid(),
  blobRef: z.string().nullable(), // object-storage pointer for large binaries; null for in-DB items
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type ContentKey = z.infer<typeof contentKeySchema>;

/** Input accepted when registering a content key; the repository fills the rest. */
export const createContentKeyInputSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.uuid(),
  blobRef: z.string().nullable().optional(),
});

export type CreateContentKeyInput = z.infer<typeof createContentKeyInputSchema>;
