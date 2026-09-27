import { z } from "zod";
import { type Gender, genderSchema } from "./gender.js";
import { standingColumnSchema, standingSchema } from "./standing.js";
import { parseTagNames } from "./tag.js";

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

/** A pet as a form holds it: every field the text the user typed. */
export interface PetDraft {
  name: string;
  gender: Gender | null;
  /** Raw tag text, parsed by {@link parseTagNames}. */
  tags: string;
}

export type PetDraftErrors = { name?: "required" };

export type PetDraftResult =
  | { ok: true; input: { name: string; gender: Gender | null }; tags: string[] }
  | { ok: false; errors: PetDraftErrors };

/** The draft a form starts from: the pet being edited, or blanks. */
export function petDraftOf(
  pet?: Pick<Pet, "name" | "gender">,
  tags = "",
): PetDraft {
  return { name: pet?.name ?? "", gender: pet?.gender ?? null, tags };
}

/** Trims the name, which is required. */
export function petInputOf(draft: PetDraft): PetDraftResult {
  const name = draft.name.trim();
  if (name === "") return { ok: false, errors: { name: "required" } };
  return {
    ok: true,
    input: { name, gender: draft.gender },
    tags: parseTagNames(draft.tags),
  };
}
