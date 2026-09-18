import { z } from "zod";
import { type EntityType, entityTypeSchema } from "./relationship.js";

/** What can hold text containing a mention. */
export const mentionBearerTypeSchema = z.enum(["reminder"]);

export type MentionBearerType = z.infer<typeof mentionBearerTypeSchema>;

/**
 * A backlink: the bearer's text mentions the target. Re-derived from the text
 * on every write; mention writes never create or delete the target.
 */
export const mentioningSchema = z.object({
  id: z.uuid(),
  bearerType: mentionBearerTypeSchema, // what holds the text
  bearerId: z.uuid(),
  targetType: entityTypeSchema, // the referenced entity (person | pet)
  targetId: z.uuid(),
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
});

export type Mentioning = z.infer<typeof mentioningSchema>;

/** A mention's target with its current label, or `null` once it is deleted. */
export interface ResolvedMention {
  targetType: EntityType;
  targetId: string;
  label: string | null;
}
