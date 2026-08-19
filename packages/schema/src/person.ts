import { z } from "zod";
import { genderSchema } from "./gender.js";

/**
 * The three parts of a person's name, every one of them optional.
 *
 * A person needs *some* name — not a first one and a last one. "Jen" and "Jen
 * Davis" are both whole people, and the two features that pushed hardest on the
 * old `firstName` + `lastName` requirement both wanted exactly this: an
 * unpublished person known only as somebody's spouse, and contact import, whose
 * parser deliberately yields incomplete names for mononyms and organisation-only
 * cards rather than fabricating a surname (`@leapsake/contact-import` →
 * `ParsedName`).
 *
 * `null` is the one way to spell "absent". `min(1)` is what keeps `""` from
 * becoming a second, indistinguishable way to spell it.
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

/**
 * At least one part of a name is present — the rule that replaces "first and
 * last are required", and the whole of what "a person must be nameable" means.
 * Exported because the forms check it before they let you save.
 */
export function hasAnyName(name: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
}): boolean {
  return (
    name.firstName != null || name.middleName != null || name.lastName != null
  );
}

/** Reported against `firstName`, so a form shows it on the field you'd fix. */
const nameRequired = {
  error: "A person needs at least one name",
  path: ["firstName"],
};

/**
 * A Person — the core entity. The full database row shape.
 *
 * Sync-safe conventions (see AGENTS.md): client-generated UUID
 * primary key, epoch-ms UTC timestamps, and a nullable `deletedAt` for soft
 * deletes (rows are never hard-deleted, so deletions can propagate during V3
 * sync).
 */
export const personSchema = z
  .object({
    id: z.uuid(),
    ...nameParts,
    gender: genderSchema.nullable(), // explicit gender; null when unset
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(), // epoch ms, UTC
    deletedAt: z.number().int().nullable(),
  })
  .refine(hasAnyName, nameRequired);

export type Person = z.infer<typeof personSchema>;

/**
 * The editable fields, each omittable. Both inputs below are built from this
 * rather than from each other, because a Zod object carrying a refinement can
 * no longer be `.partial()`'d — and only one of the two wants the refinement.
 */
const personInputBase = z.object({
  ...optionalNameParts,
  gender: genderSchema.nullable().optional(),
});

/** Input accepted when creating a Person; the repository fills the rest. */
export const createPersonInputSchema = personInputBase.refine(
  hasAnyName,
  nameRequired,
);

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;

/**
 * Input accepted when updating a Person; any subset of the editable fields.
 *
 * Deliberately **not** refined: a legitimate patch may carry no name at all
 * (`{ gender }`), so the rule cannot live here. It still holds, because
 * `entity-repo`'s `update` re-validates the whole merged row against
 * {@link personSchema} — so a patch that would erase every name is rejected by
 * the row rule, which is the only place that can see the result.
 */
export const updatePersonInputSchema = personInputBase;

export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;
