import { z } from "zod";
import { countryCodeSchema } from "./contact-method.js";
import { type Gender, genderSchema } from "./gender.js";
import { type Religion, religionSchema } from "./religion.js";
import { standingColumnSchema, standingSchema } from "./standing.js";
import { parseTagNames } from "./tag.js";

/**
 * A name's three parts, each optional; a saved person needs at least one.
 * `min(1)` keeps `""` from being a second way to spell absent.
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

/** Whether a person has the name they need: any part, unless a draft. */
function namedUnlessDraft(person: {
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  standing?: string;
}): boolean {
  return person.standing === "draft" || hasAnyName(person);
}

/** Stated values as a set, sorted, so one set always serializes one way. */
function statedSet<T extends string>(item: z.ZodType<T>) {
  return z.array(item).transform((items) => [...new Set(items)].sort());
}

/** Countries a person is a national of, and religions they hold: stated,
 *  never inferred from each other. */
const affiliations = {
  nationalities: statedSet(countryCodeSchema),
  religions: statedSet(religionSchema),
};

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
    // Defaulted, so a row from a peer that predates the columns decodes.
    nationalities: affiliations.nationalities.default([]),
    religions: affiliations.religions.default([]),
    // Defaulted, so a row from a peer that predates the column decodes.
    standing: standingColumnSchema,
    createdAt: z.number().int(), // epoch ms, UTC
    updatedAt: z.number().int(), // epoch ms, UTC
    deletedAt: z.number().int().nullable(),
  })
  .refine(namedUnlessDraft, nameRequired);

export type Person = z.infer<typeof personSchema>;

/**
 * The editable fields, each omittable. Both inputs build on this, since a
 * refined Zod object cannot be `.partial()`'d.
 */
const personInputBase = z.object({
  ...optionalNameParts,
  gender: genderSchema.nullable().optional(),
  nationalities: affiliations.nationalities.optional(),
  religions: affiliations.religions.optional(),
  standing: standingSchema.optional(),
});

/** Input accepted when creating a Person; the repository fills the rest. */
export const createPersonInputSchema = personInputBase.refine(
  namedUnlessDraft,
  nameRequired,
);

export type CreatePersonInput = z.infer<typeof createPersonInputSchema>;

/**
 * Any subset of the editable fields. Not refined, since a patch may carry no
 * name; the repo checks the merged row instead.
 */
export const updatePersonInputSchema = personInputBase;

export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>;

/** A person as a form holds it: every field the text the user typed. */
export interface PersonDraft {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: Gender | null;
  nationalities: string[];
  religions: Religion[];
  /** Raw tag text, parsed by {@link parseTagNames}. */
  tags: string;
}

/** Why a draft cannot be saved; `name` means every part of it is blank. */
export type PersonDraftErrors = { name?: "required" };

export type PersonDraftResult =
  | {
      ok: true;
      input: {
        firstName: string | null;
        middleName: string | null;
        lastName: string | null;
        gender: Gender | null;
        nationalities: string[];
        religions: Religion[];
      };
      tags: string[];
    }
  | { ok: false; errors: PersonDraftErrors };

/** The draft a form starts from: the person being edited, or blanks. */
export function personDraftOf(
  person?: Pick<Person, "firstName" | "middleName" | "lastName" | "gender"> &
    Partial<Pick<Person, "nationalities" | "religions">>,
  tags = "",
): PersonDraft {
  return {
    firstName: person?.firstName ?? "",
    middleName: person?.middleName ?? "",
    lastName: person?.lastName ?? "",
    gender: person?.gender ?? null,
    nationalities: person?.nationalities ?? [],
    religions: person?.religions ?? [],
    tags,
  };
}

const blankToNull = (text: string) => (text.trim() === "" ? null : text.trim());

/** Trims the name parts, blanks to null; any one part is enough. */
export function personInputOf(draft: PersonDraft): PersonDraftResult {
  const input = {
    firstName: blankToNull(draft.firstName),
    middleName: blankToNull(draft.middleName),
    lastName: blankToNull(draft.lastName),
    gender: draft.gender,
    nationalities: draft.nationalities,
    religions: draft.religions,
  };
  if (!hasAnyName(input)) return { ok: false, errors: { name: "required" } };
  return { ok: true, input, tags: parseTagNames(draft.tags) };
}
