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
 * plain name ("Ruth Dakin") rather than pointing at another card.
 *
 * A *named* relation becomes an **unpublished** person on import: a name attached
 * to the contact, absent from People & Pets until they turn out to be more than
 * that. Which is exactly what the source says — the card records a spouse's
 * name, not a spouse.
 *
 * A relation that instead **points at another card** ({@link ParsedRelated.otherUid})
 * becomes a real edge between two published entities, provided that card was
 * imported too; if it was skipped, it degrades to the named form above, since
 * the fact is true either way.
 */
export interface ParsedRelated {
  /** The name as the card writes it; split into parts at write time. */
  name: string;
  /** The role this person holds relative to the contact. */
  role: RelationshipRole;
  /** The card's own `TYPE`, kept as the qualifier when `role` is `other`. */
  roleNote: string | null;
  /**
   * The `UID` of the other end's own card, when the edge points at one rather
   * than merely naming somebody — a published↔published relationship, written as
   * `RELATED;VALUE=uri:urn:uuid:…`.
   *
   * `null` for every unpublished relation, whose whole point is that they have
   * no card, and for a reference whose card is **not in the file** — that one
   * cannot be resolved to anybody and stays in `dropped` instead.
   *
   * When it is set, {@link ParsedRelated.name} was recovered from that card's
   * own `FN`, because a reference carries no name of its own.
   */
  otherUid: string | null;
  /**
   * The Leapsake `relationships.id` this edge is, as `X-LEAPSAKE-REL-ID`.
   *
   * The edge appears on **both** cards — that is what vCard means by `RELATED` —
   * so this is what lets an importer recognise the two halves as one
   * relationship rather than two, which is exactly how `ingestContacts` uses it.
   * `null` for any foreign card.
   */
  relationshipId: string | null;
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
   * does not publish beside the handle (X, Discord).
   *
   * `null` for a foreign card — no source spells it in a form worth guessing at
   * — and read from `X-SOCIALPROFILE;X-LEAPSAKE-USERID=` on one of ours. It gets
   * a parameter of its own precisely because it is stored, unrecoverable from
   * the handle, and would otherwise be the one thing missing from the file the
   * user is told is their backup.
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
  /**
   * The milestone's free text. Distinct from {@link ParsedDate.label}: for kind
   * `other` the note *is* the label (that is what `note` means on that kind), and
   * for every other kind it is an annotation the label does not carry.
   *
   * `null` from the parser today — no source card has a place for it — and
   * written as a parameter on the `X-ABDATE` line rather than a property of its
   * own, so it rides the date it annotates.
   */
  note: string | null;
  /** The Leapsake `milestones.id`, for a card we wrote. `null` otherwise. */
  id: string | null;
  /**
   * The `relationships.id` this milestone is stored on, when its bearer is a
   * relationship rather than a person or a pet — a wedding belongs to the edge,
   * not to either partner.
   *
   * Such a milestone is written on **both** partners' cards, carrying the same
   * {@link ParsedDate.id}: one fact, two cards, an id that identifies the halves,
   * exactly as {@link ParsedRelated.relationshipId} does for the edge itself.
   * `null` for a milestone the entity bears itself.
   */
  relationshipId: string | null;
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
   * `people.id`/`pets.id` it came from. `null` for a card that carries none.
   *
   * **A matching key, never the id of a row an import creates.** It is what lets
   * the review say "you already have this person" instead of quietly making a
   * second copy of them, and what lets a `RELATED;VALUE=uri` resolve to a real
   * person rather than an unpublished stub. Writing these ids back verbatim
   * would be a *restore*, which is `plans/v0-2.md` → *Export*.
   */
  uid: string | null;
  /**
   * What kind of thing the card is about — a vCard `KIND` (RFC 6350 §6.1.4,
   * which allows x-names, so a pet is `KIND:x-pet`). Any other kind, ours or a
   * stranger's, reads as `"individual"`: Leapsake has two shapes, and a card
   * saying `group` is far closer to a person than to a pet.
   */
  kind: "individual" | "pet";
  /**
   * Whether this card **claims** to be the user themselves — the `self_person`
   * pointer, written as `X-LEAPSAKE-SELF:TRUE`.
   *
   * A claim on the way in and a *decision* on the way back out: the import
   * review starts every such card opted out and replaces this with the user's
   * answer before the importer sees it, so somebody else's export can never
   * silently take the pointer over.
   */
  isSelf: boolean;
  /**
   * `X-LEAPSAKE-CREATED` — epoch ms, or `null` for a card without one.
   *
   * **Read but not applied**: no `create` input accepts a `createdAt`, so an
   * imported entity is stamped with the moment it was imported. Honouring this
   * needs the row-level `insert`, which is the restore door (`plans/v0-2.md` →
   * *Export*); it is parsed now so the round trip is honest and restore has it
   * waiting.
   */
  createdAt: number | null;
  /** `REV` — epoch ms. Like {@link ParsedContact.createdAt}, read but not
   *  applied: a fresh row gets a fresh `updated_at`. */
  updatedAt: number | null;
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
   * The entity's tags — a vCard `CATEGORIES` list.
   *
   * Note what the store will do with these: a tag name is `[\p{L}\p{N}]+` and
   * nothing else, so a foreign card's "Close friends" lands as two tags. Our own
   * names went through that same filter on the way in and so survive intact.
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
  // The writer-only fields carry defaults rather than being required, so a
  // payload built before they existed still validates. They cost nothing on the
  // way in — the parser fills every one of them with the default anyway — and
  // the alternative is a boundary that rejects a renderer one build behind.
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
      note: z.string().min(1).nullable().default(null),
      id: z.string().nullable().default(null),
      relationshipId: z.string().nullable().default(null),
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
      otherUid: z.string().nullable().default(null),
      relationshipId: z.string().nullable().default(null),
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
