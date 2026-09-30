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

/** The fields of `expo-contacts`' `ContactDetails` the mapper reads. */
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

/** Trim to a non-empty string, or `null`, as the parsed schemas want. */
function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed !== "" ? trimmed : null;
}

/** A two-letter country code, or `null` for a device's free-text name. */
function isoCountry(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed !== undefined && /^[A-Za-z]{2}$/.test(trimmed)
    ? trimmed.toUpperCase()
    : null;
}

/** Apple labels rewritten to match what the vCard parser gives them. */
const PLAIN_LABELS: Record<string, string> = { iphone: "Mobile" };

/** The label to show for a contact method with none of its own. */
const DEFAULT_LABEL = "Other";

/** A device label as display text; never empty, as the schema requires. */
function label(value: string | null | undefined): string {
  const trimmed = clean(value);
  if (trimmed === null) return DEFAULT_LABEL;
  const text = appleLabelText(trimmed);
  if (text === "") return DEFAULT_LABEL;
  return PLAIN_LABELS[text.toLowerCase()] ?? text;
}

/**
 * iOS's labelled dates give an unset part as `NSIntegerMax`, which fails the
 * whole contact's write, so anything out of range is read as absent.
 */
function datePart(value: number | undefined, max: number): number | null {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= max
    ? value
    : null;
}

/** A device date as a partial civil date; `null` with no usable month. */
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

/** Map one device contact to a {@link ParsedContact}, with no native calls. */
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
    // No fax flag, so `smsCapable` defaults true.
    return [
      {
        label: label(phone.label),
        number,
        extension: null,
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

  // iOS's dedicated birthday field wins; Android has none and keeps it in
  // `dates` under a "birthday" label instead.
  const dedicatedBirthday = partialDateFrom(contact.birthday);

  // What was read but cannot be stored, so it is named rather than lost.
  const dropped: DroppedField[] = [];

  // The label is all that says what a date is: a birthday, a kind
  // `dateKindFor` recognises, or else dropped by name.
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
    // `Contact.id` is local to this address book, so it is no `UID`.
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
    // Not requested from `Contact.getAllDetails`.
    socials: [],
    birthday: dedicatedBirthday ?? birthdayFromDates,
    dates,
    // Device relationships are free-text labels with no role vocabulary.
    related: [],
    tags: [],
    dropped,
  };
}
