import { z } from "zod";

/** What can own a contact method; `household` is reserved and unused. */
export const contactOwnerTypeSchema = z.enum(["person", "household"]);

export type ContactOwnerType = z.infer<typeof contactOwnerTypeSchema>;

/** A contact-method owner, the `(type, id)` pair reads are scoped by. */
export interface ContactOwner {
  type: ContactOwnerType;
  id: string;
}

/**
 * Labels a form suggests per kind. The label is free text, so these constrain
 * nothing, and a chosen one is stored verbatim.
 */
export const emailLabelSuggestions = ["Home", "Work"] as const;
export const phoneLabelSuggestions = ["Mobile", "Home", "Work"] as const;
export const postalLabelSuggestions = ["Home", "Work"] as const;
export const socialLabelSuggestions = ["Personal", "Work"] as const;

/**
 * An ISO 3166-1 alpha-2 code, checked by shape only. Forms uppercase it before
 * it gets here.
 */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

/** The columns every contact-method row shares. */
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

// Email addresses

/**
 * An email address as entered, plus the repo's lowercased lookup key. The same
 * address may appear more than once.
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

// Phone numbers

/**
 * A phone number as typed, plus the repo's lookup key. `reachableOn` holds
 * platform ids unvalidated, so a newer build's platform still syncs.
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
 * A best-effort lookup key for a phone number: its digits, keeping a leading
 * `+` so an international number stays distinct from a national one.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/\D/g, "");
}

// Postal addresses

/**
 * A postal address as structured fields, so it can be formatted per country.
 * Only `line1` is required; the owner is the recipient.
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

// Social profiles

/**
 * An account on a messaging or social platform. `platform` is unvalidated, so
 * a newer build's platform still syncs and renders from `url`.
 */
export const socialProfileSchema = z.object({
  ...spine,
  platform: z.string().min(1),
  handle: z.string(),
  normalized: z.string(),
  /** The numeric id some platforms key direct messages on. */
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
 * The lookup key for a handle: trimmed and lowercased, since every known
 * platform treats handles case-insensitively.
 */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

// The merged view

/** Discriminates the four method shapes in a merged contact-method list. */
export type ContactMethodKind = "email" | "phone" | "postal" | "social";

/** One entry in the merged list `listContactMethods` returns. */
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
 * An address as envelope lines in Western order, empty fields dropped:
 * street, second line, "Springfield, IL 62704", country.
 */
export function postalAddressLines(addr: PostalAddressParts): string[] {
  // The comma follows the city, never splits "IL 62704".
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

/** {@link postalAddressLines} as one string, e.g. for a map query. */
export function formatPostalAddress(addr: PostalAddressParts): string {
  return postalAddressLines(addr).join(", ");
}
