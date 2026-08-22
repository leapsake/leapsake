import { z } from "zod";

/**
 * The kinds of entity that can *own* a contact method. `person` is the only
 * value reachable today; `household` is **reserved now** so a future household
 * entity can own a shared address/phone with no schema change — the same
 * forward-compatible trick as `entityTypeSchema` reserving `pet` and
 * `milestoneBearerTypeSchema` reserving `relationship`. The owner is a
 * polymorphic `(ownerType, ownerId)` pair like taggings/relationships.
 *
 * When households ship, a person's *effective* methods become `own ∪
 * household's` — a read-time union localised to `listContactMethods` in
 * `@leapsake/data`, nothing materialised.
 */
export const contactOwnerTypeSchema = z.enum(["person", "household"]);

export type ContactOwnerType = z.infer<typeof contactOwnerTypeSchema>;

/** A contact-method owner, the polymorphic `(type, id)` pair reads are scoped by. */
export interface ContactOwner {
  type: ContactOwnerType;
  id: string;
}

/**
 * Per-kind *suggested* labels, shown in the form as datalist hints. The label
 * itself is free text (`spine.label`) — the user may pick a suggestion or type
 * anything — so these constrain nothing; they only seed the picker. Stored
 * verbatim as the display label, so they are the user-facing strings, not codes.
 */
export const emailLabelSuggestions = ["Home", "Work"] as const;
// No "Fax": these are the labels worth *offering*, and a fax line is a rarity
// the free-text field still takes. An imported one keeps its label — nothing
// here constrains what is stored, only what the picker puts in front of you.
export const phoneLabelSuggestions = ["Mobile", "Home", "Work"] as const;
export const postalLabelSuggestions = ["Home", "Work"] as const;
export const socialLabelSuggestions = ["Personal", "Work"] as const;

/**
 * A country code validated *as shape* only: ISO 3166-1 alpha-2, two uppercase
 * letters. Always nullable on the methods that carry it — many addresses have no
 * meaningful country and we model real-world variation rather than rejecting it
 * (permissive over restrictive). Case is normalised at the form boundary.
 */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/**
 * The columns every contact-method row shares: a uuid id, the polymorphic owner,
 * the free-text `label` (suggestions are UI-only), and the sync-safe timestamps +
 * nullable `deletedAt` (see AGENTS.md). Everything kind-specific (address,
 * number, the postal lines) is added by each schema below.
 */
const spine = {
  id: z.uuid(),
  ownerType: contactOwnerTypeSchema,
  ownerId: z.uuid(),
  label: z.string().min(1), // free text; e.g. "Home", "Work", "Mum's place"
  createdAt: z.number().int(), // epoch ms, UTC
  updatedAt: z.number().int(),
  deletedAt: z.number().int().nullable(),
};

/** The owner + `label` accepted on create; the repo fills id/timestamps. */
const inputSpine = {
  ownerType: contactOwnerTypeSchema,
  ownerId: z.uuid(),
  label: z.string().min(1),
};

// ---------------------------------------------------------------------------
// Email addresses
// ---------------------------------------------------------------------------

/**
 * An email address. `address` is stored as entered; `normalized` (lowercased) is
 * derived by the repo for lookup and the optional duplicate warning. Dedupe is
 * **permissive** — a non-unique index, no hard uniqueness — so the same address
 * may appear more than once.
 */
export const emailAddressSchema = z.object({
  ...spine,
  address: z.string().min(1),
  normalized: z.string().min(1),
});

export type EmailAddress = z.infer<typeof emailAddressSchema>;

export const createEmailInputSchema = z.object({
  ...inputSpine,
  address: z.string().min(1),
});

export type CreateEmailInput = z.infer<typeof createEmailInputSchema>;

export const updateEmailInputSchema = z.object({
  label: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
});

export type UpdateEmailInput = z.infer<typeof updateEmailInputSchema>;

/** The lookup/dedupe key for an email: trimmed and lowercased. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------

/**
 * A phone number. `number` is whatever the user typed (national format and all);
 * `normalized` is a best-effort digits-only / E.164-ish key the repo derives for
 * lookup and click-to-call. `country` (nullable) helps interpret the number.
 * `smsCapable` answers the one question the UI cares about — "can I text this
 * person?" — and defaults to true: a number is assumed textable unless the user
 * marks it a landline/fax. Richer call-vs-text *preference* still belongs with
 * the deferred channel preferences; this is only the capability.
 *
 * `reachableOn` answers the *other* question a number raises: WhatsApp and
 * Signal are addressed by phone number, so they need no contact method of their
 * own — only the fact that this person is on them, which nothing but the user
 * knows. The ids are `@leapsake/contact-links` platform ids, held as free
 * strings on purpose: the registry decides which platforms exist, and validating
 * against it here would freeze that list into stored data and reject a row
 * synced from a device running a newer build.
 */
export const phoneNumberSchema = z.object({
  ...spine,
  number: z.string().min(1),
  normalized: z.string(), // may be empty when the input carries no digits
  extension: z.string().min(1).nullable(),
  country: countryCodeSchema.nullable(),
  smsCapable: z.boolean(),
  reachableOn: z.array(z.string()).default([]),
});

export type PhoneNumber = z.infer<typeof phoneNumberSchema>;

export const createPhoneInputSchema = z.object({
  ...inputSpine,
  number: z.string().min(1),
  extension: z.string().min(1).nullable().optional(),
  country: countryCodeSchema.nullable().optional(),
  smsCapable: z.boolean().optional(), // defaults to true in the repo
  reachableOn: z.array(z.string()).optional(), // defaults to [] in the repo
});

export type CreatePhoneInput = z.infer<typeof createPhoneInputSchema>;

export const updatePhoneInputSchema = z.object({
  label: z.string().min(1).optional(),
  number: z.string().min(1).optional(),
  extension: z.string().min(1).nullable().optional(),
  country: countryCodeSchema.nullable().optional(),
  smsCapable: z.boolean().optional(),
  reachableOn: z.array(z.string()).optional(),
});

export type UpdatePhoneInput = z.infer<typeof updatePhoneInputSchema>;

/**
 * A best-effort lookup key for a phone number: keep digits, and a single leading
 * `+` if present (so an E.164 number stays distinguishable from a national one).
 * Imperfect by design — which is why phones carry no hard-uniqueness constraint.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Postal addresses
// ---------------------------------------------------------------------------

/**
 * A postal address kept as **structured fields**, not a free-text block — so it
 * can later be reformatted per country. Only `line1` is required (a row with no
 * line is meaningless); everything else is nullable so international addresses
 * fit: no postal code, no region, reordered lines, PO boxes, APO/FPO. Ordering
 * and format are a *display* concern handled by a future country-aware formatter,
 * not by storage. There is no `recipient` field — the owner is the recipient
 * (an addressee ≠ owner is a forcing function for the deferred household entity).
 */
export const postalAddressSchema = z.object({
  ...spine,
  line1: z.string().min(1), // street / PO box
  line2: z.string().min(1).nullable(), // apt / unit / suite
  locality: z.string().min(1).nullable(), // city / town
  region: z.string().min(1).nullable(), // state / province / county
  postalCode: z.string().min(1).nullable(),
  country: countryCodeSchema.nullable(),
});

export type PostalAddress = z.infer<typeof postalAddressSchema>;

const postalInputShape = {
  line1: z.string().min(1),
  line2: z.string().min(1).nullable().optional(),
  locality: z.string().min(1).nullable().optional(),
  region: z.string().min(1).nullable().optional(),
  postalCode: z.string().min(1).nullable().optional(),
  country: countryCodeSchema.nullable().optional(),
};

export const createPostalInputSchema = z.object({
  ...inputSpine,
  ...postalInputShape,
});

export type CreatePostalInput = z.infer<typeof createPostalInputSchema>;

export const updatePostalInputSchema = z.object({
  label: z.string().min(1).optional(),
  line1: z.string().min(1).optional(),
  line2: z.string().min(1).nullable().optional(),
  locality: z.string().min(1).nullable().optional(),
  region: z.string().min(1).nullable().optional(),
  postalCode: z.string().min(1).nullable().optional(),
  country: countryCodeSchema.nullable().optional(),
});

export type UpdatePostalInput = z.infer<typeof updatePostalInputSchema>;

// ---------------------------------------------------------------------------
// Social profiles
// ---------------------------------------------------------------------------

/**
 * Someone's account on a messaging or social platform.
 *
 * `platform` is a free string, **not** an enum, and that is the load-bearing
 * decision here. The list of platforms Leapsake knows how to open lives in
 * `@leapsake/contact-links`, and validating against it would freeze that list
 * into stored data: a row synced from a device on a newer build would fail
 * validation and be dropped, and every new platform would need a migration. An
 * id this schema has never heard of is stored happily and rendered from `url`.
 *
 * `handle` is what the user typed, cleaned to a bare handle at the form boundary
 * (`bareHandle`) rather than here, since what counts as a handle is a fact about
 * the platform. `normalized` is the lookup key, derived like every other one.
 *
 * `platformUserId` exists for a specific, narrow reason: X, Discord and their
 * like key DMs on an opaque numeric id they do not publish beside the handle, so
 * a handle alone can only reach a profile. It is null for almost every row, and
 * the form offers it only where the registry says it buys something.
 *
 * `url` is the escape hatch that makes the open platform list actually work — a
 * profile URL for a platform with no template, pasted whole.
 */
export const socialProfileSchema = z.object({
  ...spine,
  platform: z.string().min(1),
  handle: z.string(),
  normalized: z.string(),
  platformUserId: z.string().min(1).nullable(),
  url: z.string().min(1).nullable(),
});

export type SocialProfile = z.infer<typeof socialProfileSchema>;

const socialInputShape = {
  platform: z.string().min(1),
  handle: z.string(),
  platformUserId: z.string().min(1).nullable().optional(),
  url: z.string().min(1).nullable().optional(),
};

export const createSocialInputSchema = z.object({
  ...inputSpine,
  ...socialInputShape,
});

export type CreateSocialInput = z.infer<typeof createSocialInputSchema>;

export const updateSocialInputSchema = z.object({
  label: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
  handle: z.string().optional(),
  platformUserId: z.string().min(1).nullable().optional(),
  url: z.string().min(1).nullable().optional(),
});

export type UpdateSocialInput = z.infer<typeof updateSocialInputSchema>;

/**
 * The lookup/dedupe key for a handle: trimmed and lowercased. Handles are
 * case-insensitive on every platform Leapsake knows, so `@JoshSmith` and
 * `@joshsmith` are one account and should match as one.
 *
 * Deliberately *not* the same function as `bareHandle` in
 * `@leapsake/contact-links`: that one decides what a handle *is* (stripping an
 * `@`, unwrapping a pasted URL), which is platform knowledge, and this package
 * must not depend on that one — it is the other way round.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// The merged view
// ---------------------------------------------------------------------------

/** Discriminates the four method shapes in a merged contact-method list. */
export type ContactMethodKind = "email" | "phone" | "postal" | "social";

/**
 * One entry in the merged list `listContactMethods` returns: a typed method
 * tagged with its `kind`. Screens consume this single union rather than repeat
 * the three-way fan-out themselves.
 */
export type ContactMethod =
  | { kind: "email"; method: EmailAddress }
  | { kind: "phone"; method: PhoneNumber }
  | { kind: "postal"; method: PostalAddress }
  | { kind: "social"; method: SocialProfile };

/** The fields a postal address is rendered from, by either formatter below. */
interface PostalAddressParts {
  line1: string;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/**
 * A postal address as the lines you would write on an envelope: street, then
 * any second line, then "Springfield, IL 62704" as one unit, then the country.
 * Empty fields collapse rather than leaving a blank line.
 *
 * This is the field order — {@link formatPostalAddress} is these lines joined
 * with commas, not a second ordering that has to be kept in step with this one.
 *
 * Like the one-line form it is **non**-country-aware: the formatter that
 * reorders by locale is still deferred, and this is the conventional Western
 * shape until it lands.
 */
export function postalAddressLines(addr: PostalAddressParts): string[] {
  // "IL 62704" is one unit and never takes an internal comma; the comma belongs
  // after the city, and only when there is a city for it to follow.
  const regionPostal = [addr.region, addr.postalCode]
    .filter((p): p is string => p !== null && p !== "")
    .join(" ");
  const city = addr.locality ?? "";
  const cityLine =
    city !== "" && regionPostal !== ""
      ? `${city}, ${regionPostal}`
      : city + regionPostal;

  return [addr.line1, addr.line2, cityLine, addr.country].filter(
    (p): p is string => p !== null && p !== "",
  );
}

/**
 * A plain, **non**-country-aware one-line rendering of a postal address: the
 * present fields joined in a conventional Western order. Used where an address
 * has to be a single string — a map query, the clipboard, a search result, a
 * sentence — while {@link postalAddressLines} is what a screen displays.
 */
export function formatPostalAddress(addr: PostalAddressParts): string {
  return postalAddressLines(addr).join(", ");
}
