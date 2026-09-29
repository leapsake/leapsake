import { type RelationshipRole, roleDefs } from "@leapsake/schema";
import type {
  ParsedContact,
  ParsedDate,
  ParsedPartialDate,
  ParsedPhone,
  ParsedPostal,
  ParsedRelated,
  ParsedSocial,
} from "./parsed-contact.js";

// The vCard writer: `vcard.ts` inverted, primitive for primitive. See the
// README's _Writing the graph_ for why our facts ride parameters.

/** vCard 4.0, where `GENDER`, `RELATED` and `KIND` come from. */
const VERSION = "4.0";

/** Longest a physical line may be, in octets, before folding. */
const FOLD_OCTETS = 75;

/** Options a writer run takes from its caller, never the environment. */
export interface WriteOptions {
  /** `PRODID`, which lets an importer detect our dialect first. */
  prodId: string;
}

/** A contact as the writer takes it: the reader's own type. */
export type ExportContact = ParsedContact;

/** Contacts as one vCard file, CRLF throughout, folded at
 *  {@link FOLD_OCTETS}. */
export function writeVCards(
  contacts: readonly ExportContact[],
  opts: WriteOptions,
): string {
  return contacts.map((contact) => writeCard(contact, opts)).join("");
}

// One card

function writeCard(contact: ExportContact, opts: WriteOptions): string {
  const lines: Line[] = [];
  const push = (line: Line): void => void lines.push(line);
  // A counter, since a group is taken before its lines are pushed; deriving
  // it from them would merge two facts into one `itemN`.
  let groups = 0;
  const nextGroup = (): string => `item${++groups}`;

  push({ name: "BEGIN", value: "VCARD" });
  push({ name: "VERSION", value: VERSION });
  push({ name: "PRODID", value: opts.prodId });
  if (contact.uid !== null) {
    push({ name: "UID", value: `urn:uuid:${contact.uid}` });
  }
  // An x-name `KIND`; Apple Contacts reads a pet as a person.
  push({
    name: "KIND",
    value: contact.kind === "pet" ? "x-pet" : "individual",
  });

  // `FN` is mandatory, so it is composed from the parts when absent.
  push({ name: "FN", value: contact.displayName ?? composeName(contact) });
  push({
    name: "N",
    // All five components, even empty, or every field shifts by one.
    value: joinStructured([
      contact.name.lastName,
      contact.name.firstName,
      contact.name.middleName ?? "",
      "",
      "",
    ]),
    structured: true,
  });

  const gender = GENDER_LETTER[contact.gender ?? ""];
  if (gender !== undefined) push({ name: "GENDER", value: gender });

  if (contact.tags.length > 0) {
    // Each tag escaped, then joined on a raw comma, so a comma stays in a tag.
    push({
      name: "CATEGORIES",
      value: contact.tags.map(escapeValue).join(","),
      structured: true,
    });
  }

  /** The `itemN.X-ABLABEL` naming a custom-labelled property, if any. */
  const pushLabel = (group: string | null, label: LabelSpelling): void => {
    if (group !== null && label.ablabel !== null) {
      push({ group, name: "X-ABLABEL", value: label.ablabel });
    }
  };

  for (const email of contact.emails) {
    const label = labelSpelling(email.label, EMAIL_TYPE_FOR_LABEL);
    const group = label.ablabel === null ? null : nextGroup();
    push({ group, name: "EMAIL", params: label.params, value: email.address });
    pushLabel(group, label);
  }
  for (const phone of contact.phones) {
    const label = labelSpelling(phone.label, PHONE_TYPE_FOR_LABEL);
    const group = label.ablabel === null ? null : nextGroup();
    push(telLine(phone, label, group));
    pushLabel(group, label);
  }
  for (const postal of contact.postals) {
    // One group for the `ADR`, its `X-ABLABEL` and its `X-ABADR` country, so
    // an address never parts from its country.
    const label = labelSpelling(postal.label, POSTAL_TYPE_FOR_LABEL);
    const group =
      label.ablabel === null && postal.country === null ? null : nextGroup();
    push(adrLine(postal, label, group));
    pushLabel(group, label);
    if (group !== null && postal.country !== null) {
      push({ group, name: "X-ABADR", value: postal.country });
    }
  }
  for (const social of contact.socials) {
    const label = labelSpelling(social.label, SOCIAL_TYPE_FOR_LABEL);
    const group = label.ablabel === null ? null : nextGroup();
    push(socialLine(social, label, group));
    pushLabel(group, label);
  }

  if (contact.birthday !== null) {
    const value = formatPartialDate(contact.birthday);
    if (value !== null) push({ name: "BDAY", value });
  }
  // Every other dated milestone, as `X-ABDATE`; `ANNIVERSARY` is never written.
  for (const date of contact.dates) {
    const value = formatPartialDate(date.date);
    if (value === null) continue;
    const group = nextGroup();
    push({ group, name: "X-ABDATE", params: milestoneParams(date), value });
    push({ group, name: "X-ABLABEL", value: date.label });
  }

  for (const relation of contact.related) push(relatedLine(relation));

  // Facts about the row come last, where Apple puts `REV`.
  if (contact.isSelf) push({ name: "X-LEAPSAKE-SELF", value: "TRUE" });
  if (contact.createdAt !== null) {
    push({
      name: "X-LEAPSAKE-CREATED",
      value: formatTimestamp(contact.createdAt),
    });
  }
  if (contact.updatedAt !== null) {
    push({ name: "REV", value: formatTimestamp(contact.updatedAt) });
  }

  push({ name: "END", value: "VCARD" });
  return lines.map(renderLine).join("");
}

/** `FN` composed from the name parts, in reading order. */
function composeName(contact: ExportContact): string {
  return [
    contact.name.firstName,
    contact.name.middleName ?? "",
    contact.name.lastName,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** `GENDER`'s sex letter: `nonbinary` is `O`, not the record-level `N`, and
 *  `null` writes nothing rather than `U`. */
const GENDER_LETTER: Record<string, string> = {
  male: "M",
  female: "F",
  nonbinary: "O",
};

// Contact methods

/** Our labels to the standard `TYPE` that reads back as each. */
const EMAIL_TYPE_FOR_LABEL: Record<string, string> = {
  Home: "HOME",
  Work: "WORK",
};

const PHONE_TYPE_FOR_LABEL: Record<string, string> = {
  Mobile: "CELL",
  Home: "HOME",
  Work: "WORK",
  Fax: "FAX",
  Main: "MAIN",
};

const POSTAL_TYPE_FOR_LABEL: Record<string, string> = {
  Home: "HOME",
  Work: "WORK",
};

const SOCIAL_TYPE_FOR_LABEL: Record<string, string> = {
  Personal: "HOME",
  Work: "WORK",
};

/** How one contact method's label is spelled on the wire. */
interface LabelSpelling {
  /** The `TYPE` param carrying it, when the standard vocabulary has one. */
  params: Param[] | undefined;
  /** The label to write as a sibling `itemN.X-ABLABEL`, when it does not. */
  ablabel: string | null;
}

/** A label as nothing (“Other”), a standard `TYPE`, or the user's own words
 *  as Apple's `itemN.X-ABLABEL`, which Contacts reads. */
function labelSpelling(
  label: string,
  known: Record<string, string>,
): LabelSpelling {
  if (label === "Other") return { params: undefined, ablabel: null };
  const type = known[label];
  if (type !== undefined) {
    return { params: [{ key: "TYPE", value: type }], ablabel: null };
  }
  return { params: undefined, ablabel: label };
}

function telLine(
  phone: ParsedPhone,
  label: LabelSpelling,
  group: string | null,
): Line {
  const params = [...(label.params ?? [])];
  // The parser's `smsCapable` is “not `FAX`”, inverted here.
  if (!phone.smsCapable && !params.some((p) => p.value === "FAX")) {
    params.push({ key: "TYPE", value: "FAX" });
  }
  // Two facts `TEL` has nowhere to put, riding it as parameters.
  if (phone.extension !== null) {
    params.push({ key: "X-LEAPSAKE-EXT", value: phone.extension });
  }
  if (phone.country !== null) {
    params.push({ key: "X-LEAPSAKE-COUNTRY", value: phone.country });
  }
  return { group, name: "TEL", params, value: phone.number };
}

/** ⚠️ `line1` is the street slot (2) and `line2` the extended (1). The country
 *  stays empty; its code goes in the sibling `X-ABADR`. */
function adrLine(
  postal: ParsedPostal,
  label: LabelSpelling,
  group: string | null,
): Line {
  return {
    group,
    name: "ADR",
    params: label.params,
    value: joinStructured([
      "",
      postal.line2 ?? "",
      postal.line1,
      postal.locality ?? "",
      postal.region ?? "",
      postal.postalCode ?? "",
      "",
    ]),
    structured: true,
  };
}

/** A social profile as Apple's `X-SOCIALPROFILE`: its URL, else the handle. */
function socialLine(
  social: ParsedSocial,
  label: LabelSpelling,
  group: string | null,
): Line {
  const params: Param[] = [
    { key: "X-SERVICE-TYPE", value: social.platform },
    ...(label.params ?? []),
  ];
  if (social.platformUserId !== null) {
    params.push({ key: "X-LEAPSAKE-USERID", value: social.platformUserId });
  }
  return {
    group,
    name: "X-SOCIALPROFILE",
    params,
    value: social.url ?? social.handle,
  };
}

// Milestones

/** The kind, id, note and relationship an `X-ABDATE` has nowhere to put. */
function milestoneParams(date: ParsedDate): Param[] {
  const params: Param[] = [
    { key: "X-LEAPSAKE-MILESTONE-KIND", value: date.kind },
  ];
  if (date.id !== null) {
    params.push({ key: "X-LEAPSAKE-MILESTONE-ID", value: date.id });
  }
  if (date.relationshipId !== null) {
    params.push({
      key: "X-LEAPSAKE-MILESTONE-REL",
      value: date.relationshipId,
    });
  }
  // Skipped when the note is the label, as on `other`, so they can't disagree.
  if (date.note !== null && date.note !== date.label) {
    params.push({ key: "X-LEAPSAKE-MILESTONE-NOTE", value: date.note });
  }
  return params;
}

// Relationships

/** A role's base to the `RELATED;TYPE=` token that reads back as it. */
const RELATED_TYPE_FOR_ROLE: Record<string, string> = {
  spouse: "spouse",
  child: "child",
  parent: "parent",
  sibling: "sibling",
  friend: "friend",
  neighbor: "neighbor",
  coworker: "co-worker",
};

/** A role's `TYPE`: its base's RFC word, else the base itself; `other` writes
 *  its note bare. `null` when there is nothing to say. */
function relatedType(relation: ParsedRelated): string | null {
  if (relation.role === "other") return relation.roleNote;
  const base: RelationshipRole = roleDefs[relation.role].base;
  return RELATED_TYPE_FOR_ROLE[base] ?? base;
}

/** One edge as `RELATED`: an unpublished person by name, a published one by
 *  `urn:uuid:`, with `VALUE` spelled out on both. */
function relatedLine(relation: ParsedRelated): Line {
  const reference = relation.otherUid !== null;
  const params: Param[] = [{ key: "VALUE", value: reference ? "uri" : "text" }];
  const type = relatedType(relation);
  if (type !== null) params.push({ key: "TYPE", value: type });
  params.push({ key: "X-LEAPSAKE-ROLE", value: relation.role });
  if (relation.relationshipId !== null) {
    params.push({ key: "X-LEAPSAKE-REL-ID", value: relation.relationshipId });
  }
  return {
    name: "RELATED",
    params,
    value: reference ? `urn:uuid:${relation.otherUid}` : relation.name,
  };
}

// Dates

/** A partial date as `1985-04-12`, `--0412` or `1985`, never with a
 *  placeholder year; see the README's _Two rules_. */
export function formatPartialDate(date: ParsedPartialDate): string | null {
  const { year, month, day } = date;
  if (month !== null) {
    const md = `${pad(month)}${day === null ? "" : pad(day)}`;
    if (year === null) return `--${md}`;
    return day === null
      ? `${pad4(year)}-${pad(month)}`
      : `${pad4(year)}-${pad(month)}-${pad(day)}`;
  }
  // No month means no day either, so a year is all that is left.
  return year === null ? null : pad4(year);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/** A timestamp as `REV`: extended, UTC, to the second. */
export function formatTimestamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 19)}Z`;
}

// Lines, params, escaping

interface Param {
  key: string;
  value: string;
}

interface Line {
  group?: string | null;
  name: string;
  params?: Param[];
  /** Raw; already escaped when `structured`, by {@link joinStructured}. */
  value: string;
  /** The value is a composite whose separators must survive escaping. */
  structured?: boolean;
}

function renderLine(line: Line): string {
  const params = (line.params ?? [])
    .map((p) => `;${p.key}=${writeParam(p.value)}`)
    .join("");
  const name = line.group == null ? line.name : `${line.group}.${line.name}`;
  const value = line.structured ? line.value : escapeValue(line.value);
  return `${foldLine(`${name}${params}:${value}`)}\r\n`;
}

/** Escapes `\` first, then `,`, `;` and newlines; a colon needs no escape. */
function escapeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Escapes each component and joins on a raw `;`, inverting
 *  `splitStructured`. */
function joinStructured(parts: readonly string[]): string {
  return parts.map(escapeValue).join(";");
}

/** A parameter value, quoted only for `;`, `,` or `:`. A `"` is dropped and a
 *  newline becomes a space, since neither has an escape. */
function writeParam(value: string): string {
  const clean = value.replace(/"/g, "").replace(/[\r\n]+/g, " ");
  return /[;:,]/.test(clean) ? `"${clean}"` : clean;
}

/** Folds a line at {@link FOLD_OCTETS} octets, never inside a UTF-8 sequence,
 *  each continuation led by one space. */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= FOLD_OCTETS) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // A continuation spends one octet on its leading space.
    const width = start === 0 ? FOLD_OCTETS : FOLD_OCTETS - 1;
    let end = Math.min(start + width, bytes.length);
    // Walk back off a continuation byte (`10xxxxxx`) to a character start.
    while (
      end > start + 1 &&
      end < bytes.length &&
      (bytes[end] & 0xc0) === 0x80
    ) {
      end--;
    }
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks.join("\r\n ");
}
