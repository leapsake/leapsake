import { z } from "zod";

/**
 * A `content_key` row: the per-item key *registry*. One row per shareable unit
 * records that an entity has a content key and which item it protects — never
 * the key bytes themselves, which live only as `key_wrap` ciphertext. The
 * envelope model is plans/encryption/model.md §3.
 *
 * Same sync-safe conventions as the domain tables (see AGENTS.md):
 * client-generated UUID PK, epoch-ms UTC timestamps, nullable `deletedAt` soft
 * delete. `entityType` is left an open string (not an enum) because the set
 * grows freely — 'person', 'pet', 'photo_album', 'share_bundle', … — without a
 * schema change.
 *
 * ⚠️ **Read this before building photos.** The `content_key_entity_active`
 * index (migration 11) enforces *one content key per entity*, but a shared
 * album is a sharing unit spanning many rows **and** blobs, which wants one key
 * per unit. Changing it is a migration, not a re-encryption — so it is
 * survivable, but check it *before* the file schema is written, not during
 * (plans/v0-2.md → *Files and media*).
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
