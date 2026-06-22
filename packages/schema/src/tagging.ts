import { z } from "zod";
import { entityTypeSchema } from "./relationship.js";

/**
 * A tagging — the join row that applies one shared {@link tagSchema} Tag to one
 * entity (a Person or Pet today). The Tags repository's public API is
 * entity-oriented (`setEntityTags`), but a tagging is its own synced row: a tag
 * that travels without its taggings means nothing, so both replicate.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via
 * whole-row LWW ({@link resolveMerge}) like the rest.
 */
export const taggingSchema = z.object({
  id: z.uuid(),
  tagId: z.uuid(),
  entityType: entityTypeSchema,
  entityId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Tagging = z.infer<typeof taggingSchema>;
