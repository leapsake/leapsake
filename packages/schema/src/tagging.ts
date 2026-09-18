import { z } from "zod";

/** What can carry a tag. */
export const tagBearerTypeSchema = z.enum([
  "person",
  "pet",
  "reminder",
  "gift_idea",
]);

export type TagBearerType = z.infer<typeof tagBearerTypeSchema>;

/** One tag applied to one bearer. */
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
