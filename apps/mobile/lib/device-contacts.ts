import type {
  DroppedField,
  ParsedContact,
  ParsedEmail,
  ParsedPhone,
  ParsedPostal,
} from "@leapsake/contact-import";
import type { ContactDetails } from "expo-contacts";

/**
 * The mobile counterpart to the desktop vCard parser (`@leapsake/contact-import`'s
 * `parseVCards`): a *format-specific* mapper turning an `expo-contacts` device
 * record into the same Leapsake-shaped {@link ParsedContact} the format-agnostic
 * ingest engine consumes. Keeping it pure — a plain data-in/data-out function
 * that never touches the native module — is what lets it run under node in a unit
 * test; the side-effectful read (permission + `Contact.getAllDetails`) lives in
 * the import screen.
 *
 * Like the vCard parser it never fabricates data: a company/mononym card with no
 * given/family name leaves the name empty (the review screen makes the user fill
 * it, and the ingest guard refuses an empty name), and fields Leapsake has no home
 * for (organisation, note) are surfaced in `dropped[]` rather than silently lost.
 */

/**
 * The slice of `expo-contacts`' `ContactDetails` the mapper reads — the fields the
 * import screen requests from `Contact.getAllDetails`. A structural subset so the
 * mapper stays decoupled from the full native record (and so a test can hand-build
 * one without the native module).
 */
export type DeviceContact = Pick<
  ContactDetails,
  | "givenName"
  | "middleName"
  | "familyName"
  | "fullName"
  | "company"
  | "note"
  | "emails"
  | "phones"
  | "addresses"
  | "birthday"
>;

/** Trim to a non-empty string, or `null` — the shape the parsed schemas want. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : null;
}

/**
 * A postal `country` only as an ISO 3166-1 alpha-2 code (what `countryCodeSchema`
 * demands). `expo-contacts` returns a free-text country *name* ("USA", "United
 * States"), which carries no reliable code — so anything that isn't already a
 * two-letter code stays `null` rather than guessing, mirroring the vCard parser.
 */
function isoCountry(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && /^[A-Za-z]{2}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : null;
}

const NOTE_CAP = 300;

/**
 * Map one device contact to a {@link ParsedContact}. Pure — no permission checks,
 * no native calls. `birthday.month` from `expo-contacts` is already 1-indexed
 * (1-12), so it maps straight onto Leapsake's civil-date month.
 */
export function deviceContactToParsed(contact: DeviceContact): ParsedContact {
  const firstName = clean(contact.givenName) ?? "";
  const lastName = clean(contact.familyName) ?? "";
  const displayName = clean(contact.fullName) ?? clean(contact.company);

  const emails: ParsedEmail[] = (contact.emails ?? []).flatMap((email) => {
    const address = clean(email.address);
    if (address === null) return [];
    return [{ label: clean(email.label) ?? "other", address }];
  });

  const phones: ParsedPhone[] = (contact.phones ?? []).flatMap((phone) => {
    const number = clean(phone.number);
    if (number === null) return [];
    // `country` stays null: an address-book number carries no reliable ISO code,
    // and `smsCapable` defaults true (the platform doesn't flag fax lines here).
    return [
      {
        label: clean(phone.label) ?? "other",
        number,
        extension: null,
        country: null,
        smsCapable: true,
      },
    ];
  });

  const postals: ParsedPostal[] = (contact.addresses ?? []).flatMap((addr) => {
    const line1 = clean(addr.street);
    if (line1 === null) return []; // no street ⇒ nothing the schema can store
    return [
      {
        label: clean(addr.label) ?? "other",
        line1,
        line2: null,
        locality: clean(addr.city),
        region: clean(addr.state) ?? clean(addr.region),
        postalCode: clean(addr.postcode),
        country: isoCountry(addr.country),
      },
    ];
  });

  const birthday =
    contact.birthday != null &&
    contact.birthday.month >= 1 &&
    contact.birthday.month <= 12
      ? {
          year: contact.birthday.year ?? null,
          month: contact.birthday.month,
          day: contact.birthday.day ?? null,
        }
      : null;

  // Surface what we read but can't store, so the review shows "Not imported: …".
  const dropped: DroppedField[] = [];
  const company = clean(contact.company);
  if (company !== null)
    dropped.push({ property: "Organization", value: company });
  const note = clean(contact.note);
  if (note !== null)
    dropped.push({ property: "Note", value: note.slice(0, NOTE_CAP) });

  return {
    name: { firstName, middleName: clean(contact.middleName), lastName },
    displayName,
    gender: null, // expo-contacts carries no gender
    emails,
    phones,
    postals,
    birthday,
    dropped,
  };
}
