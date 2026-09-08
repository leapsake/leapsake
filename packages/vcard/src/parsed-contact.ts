import {
  type MilestoneKind,
  type RelationshipRole,
  genderSchema,
  milestoneKindSchema,
  relationshipRoleSchema,
} from "@leapsake/schema";
import { z } from "zod";

/**
 * The Leapsake-shaped intermediate a parsed contact file yields: one entry per
 * card, already mapped onto the fields Leapsake stores (a Person + its contact
 * methods + an optional birthday) rather than the source format's own vocabulary.
 * The parser (format-specific) produces these; the ingest engine (format-agnostic)
 * consumes them. Keeping the intermediate here — depending only on `@leapsake/schema`
 * — is what lets the same shape cross the IPC boundary and be re-validated in the
 * main process before any write.
 *
 * Names may be **incomplete** on purpose. A source card with only an `FN`
 * ("Acme Corp") or a mononym leaves `lastName` empty rather than inventing one.
 * Leapsake now stores such a person as they came — a Person needs *some* name,
 * not a first and a last one — so these cards import rather than being refused;
 * only a card with no name at all is turned away.
 *
 * Empty string is this type's "absent", because it is what a source file's own
 * empty field yields; {@link nameInputFrom} is the one place that translates
 * that into the `null` the Person schema spells it with.
 */
export interface ParsedName {
  firstName: string;
  middleName: string | null;
  lastName: string;
}

/**
 * A {@link ParsedName} as `createPerson` input: trimmed, with every part that
 * the card left blank collapsed to `null`.
 *
 * Both sides of the import need exactly this — the engine's "is there a name at
 * all?" guard and the port that actually writes the row — and they must agree,
 * or a card passes the guard and then fails `personSchema` mid-batch.
 */
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
 * Somebody the card names as related to its contact — a vCard `RELATED` giving a
 * plain name ("Jen Davis") rather than pointing at another card.
 *
 * These become **unpublished** people on import: a name attached to the contact,
 * absent from People & Pets until they turn out to be more than that. Which is
 * exactly what the source says — the card records a spouse's name, not a spouse.
 */
export interface ParsedRelated {
  /** The name as the card writes it; split into parts at write time. */
  name: string;
  /** The role this person holds relative to the contact. */
  role: RelationshipRole;
  /** The card's own `TYPE`, kept as the qualifier when `role` is `other`. */
  roleNote: string | null;
}

/** One parsed email — the address as written plus a display label. */
export interface ParsedEmail {
  label: string;
  address: string;
}

/**
 * One parsed phone. `country` is only ever an ISO-3166 alpha-2 code (the shape
 * the schema demands) — a source number that carries no reliable country stays
 * `null` rather than guessing. `smsCapable` is `false` only for fax lines.
 */
export interface ParsedPhone {
  label: string;
  number: string;
  extension: string | null;
  country: string | null;
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

/**
 * One parsed social profile. `platform` is a `@leapsake/contact-links` id where
 * the source named something recognisable, and the source's own word otherwise —
 * a card is allowed to carry an account on a network Leapsake has never heard
 * of, and dropping it would lose a real contact method to keep a list tidy.
 *
 * `url` is set when the source gave one (an `X-SOCIALPROFILE` usually does),
 * which is what lets an unrecognised platform still open.
 */
export interface ParsedSocial {
  label: string;
  platform: string;
  handle: string;
  url: string | null;
  /**
   * The platform's own opaque account id, where the platform keys DMs on one it
   * does not publish beside the handle (X, Discord). `null` from the parser
   * today — no source card carries it in a form we recognise — but the writer
   * emits it as `X-SOCIALPROFILE;X-LEAPSAKE-USERID=`, because it is stored,
   * unrecoverable from the handle, and would otherwise be missing from the one
   * file the user is told is their backup.
   */
  platformUserId: string | null;
}

/**
 * A **partial** civil date — a source card may give only a month and day
 * (`--MM-DD`) with no year. `day` implies `month` (never a lone day), the same
 * rule the milestone schema enforces.
 */
export interface ParsedPartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

/**
 * The birthday-shaped spelling of {@link ParsedPartialDate}, kept because
 * `ParsedContact.birthday` reads better with it and because it is the name this
 * package already exports. The two are the same shape: a birthday was the only
 * date Leapsake imported until anniversaries joined it.
 */
export type ParsedBirthday = ParsedPartialDate;

/**
 * A dated occasion a source card records **besides** the birthday — an iOS/Android
 * contact "date" entry, or a vCard `ANNIVERSARY`.
 *
 * The `kind` is resolved by the *parser* (the format-specific half), the same
 * division {@link ParsedRelated} uses for `RELATED;TYPE=` → `RelationshipRole`:
 * only labels Leapsake has a kind for become entries here, and everything else
 * is surfaced in `dropped[]` instead. That keeps the guesswork in one place and
 * lets the boundary schema validate against the real milestone vocabulary.
 *
 * A card's birthday never arrives here — it fills {@link ParsedContact.birthday},
 * whichever field the platform happened to carry it in.
 */
export interface ParsedDate {
  /** The milestone kind this date lands on. */
  kind: MilestoneKind;
  /** The source's own label, for the review UI and for an `other` kind's note. */
  label: string;
  date: ParsedPartialDate;
}

/**
 * A source field Leapsake has no home for yet (a free-text NOTE, an organisation,
 * a photo, a URL, a free-text address country…). Surfaced — not silently dropped —
 * so the review UI can show the user exactly what will not be imported.
 */
export interface DroppedField {
  property: string;
  value: string;
}

/** One parsed contact — everything one source card contributed, Leapsake-shaped. */
export interface ParsedContact {
  /**
   * The entity's stable id — a vCard `UID`, which for a card **we** wrote is the
   * Leapsake `people.id` it came from.
   *
   * `null` for every card the parser produces today: `UID` is in `STRUCTURAL`
   * and ignored on the way in (`plans/export.md` increment 5 is what changes
   * that, and is also what lets a `RELATED;VALUE=uri` resolve to a real person
   * instead of an unpublished stub). The field exists now because the *writer*
   * needs somewhere to read it from, and a second contact type carried alongside
   * this one would be the thing that lets the two halves drift.
   */
  uid: string | null;
  name: ParsedName;
  /** The source display name (vCard `FN`), kept for the review UI even when the
   *  structured name was derived from it. `null` when the card carried none. */
  displayName: string | null;
  gender: z.infer<typeof genderSchema> | null;
  emails: ParsedEmail[];
  phones: ParsedPhone[];
  postals: ParsedPostal[];
  socials: ParsedSocial[];
  birthday: ParsedBirthday | null;
  /** Dated occasions other than the birthday (anniversaries today). */
  dates: ParsedDate[];
  related: ParsedRelated[];
  /**
   * The entity's tags — a vCard `CATEGORIES` list. `[]` from the parser today
   * for the same reason {@link ParsedContact.uid} is `null`: reading the
   * property back into taggings is increment 5.
   */
  tags: string[];
  dropped: DroppedField[];
}

// ---------------------------------------------------------------------------
// Boundary schema
// ---------------------------------------------------------------------------

/**
 * Validates a `ParsedContact` at the main-process trust boundary — the renderer
 * parses the dropped file and sends these over IPC, so the payload is untrusted
 * and re-parsed here (as every write channel is). Deliberately **permissive on
 * names**: `firstName`/`lastName` may be empty here so the mononym/org-only case
 * reaches the ingest engine's per-contact guard (which records a friendly error)
 * rather than throwing at the boundary and failing the whole import.
 */
export const parsedContactSchema = z.object({
  uid: z.string().nullable(),
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
      country: z.string().nullable(),
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
  // A kind that isn't one Leapsake knows is refused rather than coerced, for the
  // same reason `related.role` is: the parser's mapping and the writer's must
  // agree, and this is the boundary that makes them.
  dates: z.array(
    z.object({
      kind: milestoneKindSchema,
      label: z.string().min(1),
      date: z.object({
        year: z.number().int().nullable(),
        month: z.number().int().nullable(),
        day: z.number().int().nullable(),
      }),
    }),
  ),
  // A role that isn't one Leapsake knows is a payload we refuse rather than
  // silently coerce — the renderer's mapping and the writer's must agree, and
  // this is the boundary that makes them.
  related: z.array(
    z.object({
      name: z.string().min(1),
      role: relationshipRoleSchema,
      roleNote: z.string().min(1).nullable(),
    }),
  ),
  tags: z.array(z.string().min(1)),
  dropped: z.array(z.object({ property: z.string(), value: z.string() })),
});

/** A `ParsedContact[]` payload — validates the `import.preview` channel args. */
export const parsedContactsSchema = z.array(parsedContactSchema);

/**
 * The reviewed decisions the `import.commit` channel accepts. Kept here beside
 * {@link parsedContactSchema} so the whole trust-boundary shape lives in one
 * place and the desktop app needs no zod of its own.
 */
export const importDecisionsSchema = z.array(
  z.object({
    action: z.enum(["create", "skip"]),
    contact: parsedContactSchema,
  }),
);
