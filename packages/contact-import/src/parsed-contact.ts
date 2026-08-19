import { genderSchema } from "@leapsake/schema";
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
 * A birthday as a **partial** civil date — a source card may give only a month
 * and day (`--MM-DD`) with no year. `day` implies `month` (never a lone day), the
 * same rule the milestone schema enforces.
 */
export interface ParsedBirthday {
  year: number | null;
  month: number | null;
  day: number | null;
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
  name: ParsedName;
  /** The source display name (vCard `FN`), kept for the review UI even when the
   *  structured name was derived from it. `null` when the card carried none. */
  displayName: string | null;
  gender: z.infer<typeof genderSchema> | null;
  emails: ParsedEmail[];
  phones: ParsedPhone[];
  postals: ParsedPostal[];
  birthday: ParsedBirthday | null;
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
  birthday: z
    .object({
      year: z.number().int().nullable(),
      month: z.number().int().nullable(),
      day: z.number().int().nullable(),
    })
    .nullable(),
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
