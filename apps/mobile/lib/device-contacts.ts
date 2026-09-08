import {
  appleLabelText,
  dateKindFor,
  type DroppedField,
  type ParsedContact,
  type ParsedDate,
  type ParsedEmail,
  type ParsedPartialDate,
  type ParsedPhone,
  type ParsedPostal,
} from "@leapsake/vcard";
import type { ContactDate, ContactDetails } from "expo-contacts";

/**
 * The mobile counterpart to the desktop vCard parser (`@leapsake/vcard`'s
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
  | "dates"
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

/**
 * A couple of constants Apple ships *unwrapped* (`CNLabelPhoneNumberiPhone` is
 * just `"iPhone"`). Only the ones we deliberately rewrite are listed: "iPhone"
 * becomes "Mobile" so a contact imported from the device and the same contact
 * imported as a vCard — where the parser maps `TYPE=IPHONE` the same way — carry
 * the same label. `iCloud`, `Apple Watch` and friends read fine as-is.
 */
const PLAIN_LABELS: Record<string, string> = { iphone: "Mobile" };

/** The label to show for a contact method with none of its own. */
const DEFAULT_LABEL = "Other";

/**
 * Turn a device label into display text: unwrap an Apple label constant (shared
 * with the vCard importer, which meets the very same constants in an exported
 * card), or pass free text through. Falls back to {@link DEFAULT_LABEL} when
 * there is nothing — contact-method labels are `min(1)` in the parsed schema.
 */
function label(value: string | null | undefined): string {
  const trimmed = clean(value);
  if (trimmed === null) return DEFAULT_LABEL;
  const text = appleLabelText(trimmed);
  if (text === "") return DEFAULT_LABEL;
  return PLAIN_LABELS[text.toLowerCase()] ?? text;
}

/**
 * One component of a device date, or `null` when it is missing or is not a value
 * a civil date could hold.
 *
 * The range check is not idle defensiveness. iOS reads the labelled `dates` list
 * off `NSDateComponents`, whose components are *not* optional: an unset one holds
 * the sentinel `NSDateComponentUndefined` (`NSIntegerMax`), and `expo-contacts`
 * copies it into the record verbatim instead of reading it as absent. So an
 * anniversary saved with the year left off — the `X-APPLE-OMIT-YEAR` date the
 * Contacts app writes — reaches us as year `9223372036854775807`, and passing that
 * through failed the *entire contact* at the write, since `milestoneSchema`'s
 * `z.number().int()` caps at `Number.MAX_SAFE_INTEGER`. The dedicated birthday
 * field escapes it (its mapper reads Swift's `DateComponents`, whose parts really
 * are optional) and so does Android (its record's parts are nullable), which is
 * why only a year-less *anniversary* ever brought a card down.
 */
function datePart(value: number | undefined, max: number): number | null {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= max
    ? value
    : null;
}

/**
 * An `expo-contacts` {@link ContactDate} as Leapsake's partial civil date, or
 * `null` when it carries no usable month. `month` is already 1-indexed (1-12) on
 * both platforms, so it maps straight across; `year` is optional (a date without
 * one recurs annually), and every part is read through {@link datePart} so a
 * sentinel or malformed component is treated as absent rather than stored.
 */
function partialDateFrom(
  value: ContactDate | null | undefined,
): ParsedPartialDate | null {
  if (value == null) return null;
  const month = datePart(value.month, 12);
  if (month === null) return null;
  return {
    year: datePart(value.year, 9999),
    month,
    day: datePart(value.day, 31),
  };
}

/** A partial date as compact text, for a `dropped[]` entry's value. */
function partialDateText(date: ParsedPartialDate): string {
  return [
    date.year === null ? "" : String(date.year).padStart(4, "0"),
    date.month === null ? "" : String(date.month).padStart(2, "0"),
    date.day === null ? "" : String(date.day).padStart(2, "0"),
  ]
    .filter((part) => part !== "")
    .join("-");
}

const NOTE_CAP = 300;

/**
 * Map one device contact to a {@link ParsedContact}. Pure — no permission checks,
 * no native calls. Every date from `expo-contacts` is already 1-indexed (1-12) in
 * its month, so it maps straight onto Leapsake's civil-date month.
 *
 * The two date sources are handled asymmetrically on purpose: the dedicated
 * birthday field is authoritative where the platform has one (iOS), and the
 * labelled `dates` list supplies the birthday only where it doesn't (Android),
 * plus any anniversary on either.
 */
export function deviceContactToParsed(contact: DeviceContact): ParsedContact {
  const firstName = clean(contact.givenName) ?? "";
  const lastName = clean(contact.familyName) ?? "";
  const displayName = clean(contact.fullName) ?? clean(contact.company);

  const emails: ParsedEmail[] = (contact.emails ?? []).flatMap((email) => {
    const address = clean(email.address);
    if (address === null) return [];
    return [{ label: label(email.label), address }];
  });

  const phones: ParsedPhone[] = (contact.phones ?? []).flatMap((phone) => {
    const number = clean(phone.number);
    if (number === null) return [];
    // `country` stays null: an address-book number carries no reliable ISO code,
    // and `smsCapable` defaults true (the platform doesn't flag fax lines here).
    return [
      {
        label: label(phone.label),
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
        label: label(addr.label),
        line1,
        line2: null,
        locality: clean(addr.city),
        region: clean(addr.state) ?? clean(addr.region),
        postalCode: clean(addr.postcode),
        country: isoCountry(addr.country),
      },
    ];
  });

  // iOS keeps the birthday in its own dedicated field (`CNContactBirthdayKey`),
  // which is authoritative when present. Android has no such field at all — its
  // `GetContactDetailsRecord` carries none — and keeps the birthday in `dates`
  // under a "birthday" label, which is why the fallback below exists.
  const dedicatedBirthday = partialDateFrom(contact.birthday);

  // Surface what we read but can't store, so the review shows "Not imported: …".
  const dropped: DroppedField[] = [];

  // The platform's "other dates" list. Everything here is labelled, and the label
  // is the only thing saying what the date *is* — so it is routed through
  // {@link dateKindFor} rather than assumed — the same map the vCard importer
  // routes an `X-ABDATE` through. Three outcomes, in order:
  //
  //  1. "birthday" — the Android birthday (that platform has no dedicated field).
  //     It fills the birthday only if the dedicated field was empty, so on iOS a
  //     duplicate entry can never mint a second birthday milestone.
  //  2. a label with a kind — an anniversary today.
  //  3. anything else — dropped, and *named*, so the review says "Not imported:
  //     Date (Graduation)" rather than losing it in silence.
  const dates: ParsedDate[] = [];
  let birthdayFromDates: ParsedPartialDate | null = null;
  for (const entry of contact.dates ?? []) {
    const date = partialDateFrom(entry.date);
    if (date === null) continue; // no usable month ⇒ nothing to record
    const text = label(entry.label);
    const token = text.toLowerCase();
    if (token === "birthday") {
      birthdayFromDates ??= date;
      continue;
    }
    const kind = dateKindFor(token);
    if (kind === null) {
      dropped.push({
        property: `Date (${text})`,
        value: partialDateText(date),
      });
      continue;
    }
    dates.push({
      kind,
      label: text,
      date,
      // The device API has no place for a milestone's note or its id — a
      // contact's date entry is a label and a value, nothing else.
      note: null,
      id: null,
      relationshipId: null,
    });
  }

  const company = clean(contact.company);
  if (company !== null)
    dropped.push({ property: "Organization", value: company });
  const note = clean(contact.note);
  if (note !== null)
    dropped.push({ property: "Note", value: note.slice(0, NOTE_CAP) });

  return {
    // The device API exposes no stable cross-device id we could carry as a
    // `UID` — `Contact.id` is local to this address book — and no tag concept
    // at all. Both stay at the parser's absent value, as do the four facts only
    // a Leapsake-written card carries.
    uid: null,
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
    name: { firstName, middleName: clean(contact.middleName), lastName },
    displayName,
    gender: null, // expo-contacts carries no gender
    emails,
    phones,
    postals,
    // `expo-contacts` exposes `socialProfiles` and `instantMessageAddresses`,
    // but the import screen does not request either today — adding them is a
    // change to what `Contact.getAllDetails` is asked for, not to this mapper.
    socials: [],
    birthday: dedicatedBirthday ?? birthdayFromDates,
    dates,
    // expo-contacts does expose `relationships`, but only ever as a free-text
    // label and a name, with no role vocabulary to map — unlike a vCard's
    // `RELATED;TYPE=`. Reading them would mean guessing at the role, so they are
    // left alone until there is a reason to.
    related: [],
    tags: [],
    dropped,
  };
}
