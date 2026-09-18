import { z } from "zod";
import { genderSchema } from "./gender.js";
import { standingColumnSchema, standingSchema } from "./standing.js";

/**
 * A name's three parts, each optional; a person needs at least one. `min(1)`
 * keeps `""` from being a second way to spell absent.
 */
const nameParts = {
  firstName: z.string().min(1).nullable(),
  middleName: z.string().min(1).nullable(),
  lastName: z.string().min(1).nullable(),
};

/** The same three parts, each also omittable — the shape an input takes. */
const optionalNameParts = {
  firstName: z.string().min(1).nullable().optional(),
  middleName: z.string().min(1).nullable().optional(),
  lastName: z.string().min(1).nullable().optional(),
};

/** Whether at least one part of a name is present. */
export function hasAnyName(name: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): boolean {
  return (
    name.firstName != null || name.middleName != null || name.lastName != null
  );
}

/**
 * Split a one-string name at its first space into first and last name. It does
 * not guess at particles or suffixes.
 */
export function splitName(text: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = text.trim();
  const space = trimmed.indexOf(" ");
  if (trimmed === "") return { firstName: null, lastName: null };
  if (space === -1) return { firstName: trimmed, lastName: null };
  return {
    firstName: trimmed.slice(0, space),
    lastName: trimmed.slice(space + 1).trim(),
  };
}

/** Reported against `firstName`, so a form shows it on the field you'd fix. */
const nameRequired = {
  error: "A person needs at least one name",
  path: ["firstName"],
};

/** A person, as stored. */
export const personSchema = z
  .object({
    id: z.uuid(),
    ...nameParts,
    gender: genderSchema.nullable(), // explicit gender; null when unset
    // Defaulted, so a row from a peer that predates the column decodes.
    standing: standingColumnSchema,
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(), // epoch ms, UTC
    deletedAt: z.number().int().nullable(),
  })
  .refine(hasAnyName, nameRequired);

export type Person = z.infer<typeof personSchema>;

/**
 * The editable fields, each omittable. Both inputs build on this, since a
 * refined Zod object cannot be `.partial()`'d.
 */
const personInputBase = z.object({
  ...optionalNameParts,
  gender: genderSchema.nullable().optional(),
  standing: standingSchema.optional(),
});

/** Input accepted when creating a Person; the repository fills the rest. */
export const createPersonInputSchema = personInputBase.refine(
  hasAnyName,
  nameRequired,
);

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;

/**
 * Any subset of the editable fields. Not refined, since a patch may carry no
 * name; the repo checks the merged row instead.
 */
export const updatePersonInputSchema = personInputBase;

export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
