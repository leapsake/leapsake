import {
  type MilestoneKind,
  type RelationshipRole,
  genderSchema,
  milestoneKindSchema,
  relationshipRoleSchema,
} from "@leapsake/schema";
import { z } from "zod";

/** A card's name, possibly partial; `""` is absent until
 *  {@link nameInputFrom} turns it into `null`. */
export interface ParsedName {
  firstName: string;
  middleName: string | null;
  lastName: string;
}

/** A {@link ParsedName} as `createPerson` input, blanks as `null`; the ingest
 *  guard and the writing port both use it, so they agree. */
export function nameInputFrom(name: ParsedName): {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
} {
  const clean = (value: string | null): string | null => {
    const text = (value ?? "").trim();
    return text === "" ? null : text;
  };
  return {
    firstName: clean(name.firstName),
    middleName: clean(name.middleName),
    lastName: clean(name.lastName),
  };
}

/**
 * Somebody a card names as related: by name, imported as an unpublished
 * person, or by another card's `UID`, imported as an edge between the two.
 */
export interface ParsedRelated {
  /** The name as the card writes it; split into parts at write time. */
  name: string;
  /** The role this person holds relative to the contact. */
  role: RelationshipRole;
  /** The card's own `TYPE`, kept as the qualifier when `role` is `other`. */
  roleNote: string | null;
  /** The other end's card `UID` from `RELATED;VALUE=uri`, whose `FN` gave the
   *  name; `null` for a named relation. */
  otherUid: string | null;
  /** `X-LEAPSAKE-REL-ID`, which joins the edge's halves on both cards; `null`
   *  for a foreign card. */
  relationshipId: string | null;
}

/** One parsed email: the address as written plus a display label. */
export interface ParsedEmail {
  label: string;
  address: string;
}

/** One parsed phone; `smsCapable` is `false` only for fax. */
export interface ParsedPhone {
  label: string;
  number: string;
  extension: string | null;
  smsCapable: boolean;
}

/** One parsed postal address, structured to match `postalAddressSchema`. */
export interface ParsedPostal {
  label: string;
  line1: string;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/** One parsed social profile; an unrecognised `platform` keeps the source's
 *  word, and its `url` still opens. */
export interface ParsedSocial {
  label: string;
  platform: string;
  handle: string;
  url: string | null;
  /** The opaque account id some platforms key DMs on, from our own
   *  `X-LEAPSAKE-USERID`; `null` for a foreign card. */
  platformUserId: string | null;
}

/** A partial civil date, as in `--MM-DD`; a day always has a month. */
export interface ParsedPartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/** {@link ParsedPartialDate}, named for `ParsedContact.birthday`. */
export type ParsedBirthday = ParsedPartialDate;

/** A dated occasion besides the birthday, its kind resolved by the parser;
 *  a date with no kind goes to `dropped[]` instead. */
export interface ParsedDate {
  /** The milestone kind this date lands on. */
  kind: MilestoneKind;
  /** The source's own label, for the review and an `other` kind's note. */
  label: string;
  date: ParsedPartialDate;
  /** The milestone's note, from `X-LEAPSAKE-MILESTONE-NOTE`; for `other` it is
   *  the label. */
  note: string | null;
  /** The Leapsake `milestones.id`, for a card we wrote. `null` otherwise. */
  id: string | null;
  /** The relationship bearing this milestone, written on both partners' cards
   *  with one {@link ParsedDate.id}; else `null`. */
  relationshipId: string | null;
}

/** A source field Leapsake has no home for, shown in the review. */
export interface DroppedField {
  property: string;
  value: string;
}

/** Everything one source card contributed, Leapsake-shaped. */
export interface ParsedContact {
  /** The card's `UID`: a matching key, never the id of an imported row. */
  uid: string | null;
  /** The card's `KIND`: `x-pet` is a pet, and anything else a person. */
  kind: "individual" | "pet";
  /** `X-LEAPSAKE-SELF`: the card's claim, which the review replaces with the
   *  user's answer before import. */
  isSelf: boolean;
  /** `X-LEAPSAKE-CREATED` in epoch ms: read, but not applied on import. */
  createdAt: number | null;
  /** `REV` in epoch ms; read, like {@link ParsedContact.createdAt}. */
  updatedAt: number | null;
  name: ParsedName;
  /** The card's `FN`, kept for the review, or `null`. */
  displayName: string | null;
  gender: z.infer<typeof genderSchema> | null;
  emails: ParsedEmail[];
  phones: ParsedPhone[];
  postals: ParsedPostal[];
  socials: ParsedSocial[];
  birthday: ParsedBirthday | null;
  /** Dated occasions other than the birthday. */
  dates: ParsedDate[];
  related: ParsedRelated[];
  /** `CATEGORIES`; the store splits a foreign “Close friends” into two tags. */
  tags: string[];
  dropped: DroppedField[];
}

// Boundary schema

/** Re-validates a renderer's `ParsedContact` in the main process; names may be
 *  empty, so the ingest guard reports a nameless card alone. */
export const parsedContactSchema = z.object({
  uid: z.string().nullable(),
  // Defaults, not required, so a renderer one build behind still validates.
  kind: z.enum(["individual", "pet"]).default("individual"),
  isSelf: z.boolean().default(false),
  createdAt: z.number().int().nullable().default(null),
  updatedAt: z.number().int().nullable().default(null),
  name: z.object({
    firstName: z.string(),
    middleName: z.string().nullable(),
    lastName: z.string(),
  }),
  displayName: z.string().nullable(),
  gender: genderSchema.nullable(),
  emails: z.array(
    z.object({ label: z.string().min(1), address: z.string().min(1) }),
  ),
  phones: z.array(
    z.object({
      label: z.string().min(1),
      number: z.string().min(1),
      extension: z.string().min(1).nullable(),
      smsCapable: z.boolean(),
    }),
  ),
  postals: z.array(
    z.object({
      label: z.string().min(1),
      line1: z.string().min(1),
      line2: z.string().min(1).nullable(),
      locality: z.string().min(1).nullable(),
      region: z.string().min(1).nullable(),
      postalCode: z.string().min(1).nullable(),
      country: z.string().nullable(),
    }),
  ),
  socials: z.array(
    z.object({
      label: z.string().min(1),
      platform: z.string().min(1),
      handle: z.string(),
      url: z.string().min(1).nullable(),
      platformUserId: z.string().min(1).nullable(),
    }),
  ),
  birthday: z
    .object({
      year: z.number().int().nullable(),
      month: z.number().int().nullable(),
      day: z.number().int().nullable(),
    })
    .nullable(),
  // An unknown kind is refused, not coerced, as `related.role` is below.
  dates: z.array(
    z.object({
      kind: milestoneKindSchema,
      label: z.string().min(1),
      date: z.object({
        year: z.number().int().nullable(),
        month: z.number().int().nullable(),
        day: z.number().int().nullable(),
      }),
      note: z.string().min(1).nullable().default(null),
      id: z.string().nullable().default(null),
      relationshipId: z.string().nullable().default(null),
    }),
  ),
  // An unknown role is refused, not coerced: parser and writer must agree.
  related: z.array(
    z.object({
      name: z.string().min(1),
      role: relationshipRoleSchema,
      roleNote: z.string().min(1).nullable(),
      otherUid: z.string().nullable().default(null),
      relationshipId: z.string().nullable().default(null),
    }),
  ),
  tags: z.array(z.string().min(1)),
  dropped: z.array(z.object({ property: z.string(), value: z.string() })),
});

/** Validates the `import.preview` channel's `ParsedContact[]`. */
export const parsedContactsSchema = z.array(parsedContactSchema);

/** The reviewed decisions the `import.commit` channel accepts. */
export const importDecisionsSchema = z.array(
  z.object({
    action: z.enum(["create", "skip"]),
    contact: parsedContactSchema,
  }),
);
