import { z } from "zod";

/**
 * The entity types that can *bear* a tag — a Person, Pet, Reminder, or GiftIdea.
 * A tag is a shared label an entity carries; the bearer is a polymorphic
 * `(bearerType, bearerId)` pair, so a new bearer type joins as **one line here**,
 * with no migration (`gift_idea` did exactly that — plans/gifts.md sequencing 4).
 * Kept **separate** from relationship's `entityTypeSchema` (role-holders): a
 * reminder can bear a tag but can't hold a relationship role — the same reason
 * milestones use their own {@link milestoneBearerTypeSchema}.
 */
export const tagBearerTypeSchema = z.enum([
  "person",
  "pet",
  "reminder",
  "gift_idea",
]);

export type TagBearerType = z.infer<typeof tagBearerTypeSchema>;

/**
 * A tagging — the join row that applies one shared {@link tagSchema} Tag to one
 * bearer (a Person or Pet today). The Tags repository's public API is
 * bearer-oriented (`setEntityTags`), but a tagging is its own synced row: a tag
 * that travels without its taggings means nothing, so both replicate.
 *
 * Same sync-safe substrate as every domain row (see AGENTS.md): client
 * UUID id, epoch-ms UTC timestamps, nullable `deletedAt` — so it merges via
 * whole-row LWW ({@link resolveMerge}) like the rest.
 */
export const taggingSchema = z.object({
  id: z.uuid(),
  tagId: z.uuid(),
  bearerType: tagBearerTypeSchema,
  bearerId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Tagging = z.infer<typeof taggingSchema>;
