import { z } from "zod";
import { genderSchema } from "./gender.js";
import { standingColumnSchema, standingSchema } from "./standing.js";

/** A pet, as stored. */
export const petSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  gender: genderSchema.nullable(), // explicit gender; null when unset
  // Defaulted, so a row from a peer that predates the column decodes.
  standing: standingColumnSchema,
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(), // epoch ms, UTC
  deletedAt: z.number().int().nullable(),
});

export type Pet = z.infer<typeof petSchema>;

/** Input accepted when creating a Pet; the repository fills the rest. */
export const createPetInputSchema = z.object({
  name: z.string().min(1),
  gender: genderSchema.nullable().optional(),
  standing: standingSchema.optional(),
});

export type CreatePetInput = z.infer<typeof createPetInputSchema>;

/** Input accepted when updating a Pet; any subset of the editable fields. */
export const updatePetInputSchema = createPetInputSchema.partial();

export type UpdatePetInput = z.infer<typeof updatePetInputSchema>;
