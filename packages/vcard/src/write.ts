import type {
  ParsedContact,
  ParsedPartialDate,
  ParsedPhone,
  ParsedPostal,
  ParsedSocial,
} from "./parsed-contact.js";

/**
 * The vCard **writer** — `vcard.ts` inverted, property for property.
 *
 * Every primitive here undoes exactly one of the parser's, and they live in one
 * package for that reason: `foldLine` against `unfold`, `escapeValue` against
 * `unescapeValue`, `joinStructured` against `splitStructured`, `writeParam`
 * against `splitUnquoted` + `unquote`, `formatPartialDate` against
 * `parsePartialDate`, {@link TYPE_FOR_LABEL} against `labelFrom`. The test that
 * matters is `parseVCards(writeVCards(x)) ≡ x`, and it only exists because both
 * halves are here.
 *
 * **Scope is `plans/export.md` increment 1**: the published person and their
 * contact methods. Pets, unpublished people as `RELATED`, the nine non-birthday
 * milestone kinds, relationships, `X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED`
 * are increment 2 and deliberately absent — a card this writes is a real card,
 * just not yet the whole graph.
 */

/**
 * vCard 4.0. The version is a **free choice**, not a compromise: the device
 * probes recorded in `plans/export.md` imported both 3.0 and 4.0 into iOS
 * Contacts with identical results for every date spelling tried, so nothing is
 * bought by writing the older one. 4.0 is where `GENDER`, `RELATED` and
 * `KIND` (increment 2) come from, so it is the version the vocabulary matches.
 */
const VERSION = "4.0";

/** Longest a physical line may be, in **octets**, before folding (RFC 6350 §3.2). */
const FOLD_OCTETS = 75;

/** Options a writer run needs from its caller — never read from the environment. */
export interface WriteOptions {
  /**
   * `PRODID` — who wrote this file. RFC 6350 §6.7.3, and the thing that lets an
   * importer detect the dialect before trusting any `X-LEAPSAKE-*` in it.
   */
  prodId: string;
}

/**
 * A contact as the writer takes it. Identical to {@link ParsedContact} on
 * purpose — a second type here is what would let the reader's shape and the
 * writer's drift, and the round-trip test would no longer typecheck.
 */
export type ExportContact = ParsedContact;

/**
 * Serialize contacts to one vCard file: `BEGIN:VCARD`…`END:VCARD` per contact,
 * CRLF throughout, folded at {@link FOLD_OCTETS}.
 */
export function writeVCards(
  contacts: readonly ExportContact[],
  opts: WriteOptions,
): string {
  return contacts.map((contact) => writeCard(contact, opts)).join("");
}

// ---------------------------------------------------------------------------
// One card
// ---------------------------------------------------------------------------

function writeCard(contact: ExportContact, opts: WriteOptions): string {
  const lines: Line[] = [];
  const push = (line: Line): void => void lines.push(line);

  push({ name: "BEGIN", value: "VCARD" });
  push({ name: "VERSION", value: VERSION });
  push({ name: "PRODID", value: opts.prodId });
  if (contact.uid !== null) {
    push({ name: "UID", value: `urn:uuid:${contact.uid}` });
  }

  // `FN` is the one property RFC 6350 makes mandatory, so it is composed from
  // the parts when the contact carries no display name of its own rather than
  // being written empty — an `FN`-less card is one our own parser refuses.
  push({ name: "FN", value: contact.displayName ?? composeName(contact) });
  push({
    name: "N",
    // N is `family;given;additional;prefixes;suffixes` — five components, and
    // the two we never fill are still written, because a structured value with
    // components missing is what shifts every field by one on the way back.
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
    // A list value: each tag escaped on its own, then joined on a *raw* comma,
    // which is what makes a tag containing a comma survive as one tag.
    push({
      name: "CATEGORIES",
      value: contact.tags.map(escapeValue).join(","),
      structured: true,
    });
  }

  for (const email of contact.emails) {
    push({
      name: "EMAIL",
      params: labelParams(email.label, EMAIL_TYPE_FOR_LABEL),
      value: email.address,
    });
  }
  for (const phone of contact.phones) push(telLine(phone));
  for (const postal of contact.postals) {
    // An address's ISO country rides in a sibling `X-ABADR`, so the pair needs a
    // group to tie them together — Apple's convention, and what `countryCode`
    // reads as its hint.
    const group = postal.country === null ? null : nextGroup(lines);
    push(adrLine(postal, group));
    if (group !== null && postal.country !== null) {
      push({ group, name: "X-ABADR", value: postal.country });
    }
  }
  for (const social of contact.socials) push(socialLine(social));

  if (contact.birthday !== null) {
    const value = formatPartialDate(contact.birthday);
    if (value !== null) push({ name: "BDAY", value });
  }

  push({ name: "END", value: "VCARD" });
  return lines.map(renderLine).join("");
}

/** `FN` for a contact that carried no display name: the parts, in reading order. */
function composeName(contact: ExportContact): string {
  return [
    contact.name.firstName,
    contact.name.middleName ?? "",
    contact.name.lastName,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/**
 * `GENDER`'s sex component (RFC 6350 §6.2.7), inverting `parseGender`.
 *
 * `nonbinary` writes `O` ("other") rather than `N` ("none"): both parse back to
 * `nonbinary` here, but they do not mean the same thing to anyone else — `N` is
 * "not applicable", which is a claim about the record, and `O` is a claim about
 * the person, which is what the field holds. A `null` gender writes nothing at
 * all; `U` ("unknown") would assert we asked and could not find out.
 */
const GENDER_LETTER: Record<string, string> = {
  male: "M",
  female: "F",
  nonbinary: "O",
};

// ---------------------------------------------------------------------------
// Contact methods
// ---------------------------------------------------------------------------

/**
 * Our label vocabulary → the standard `TYPE` that reads back as it, inverting
 * the `known` tables `labelFrom` consults. A label absent from the relevant
 * table is written *as itself* — an x-name `TYPE` in all but spelling, which
 * `plans/export.md` blesses as one of the four extension points — and returns
 * through `labelFrom`'s title-case fallback: `TYPE=Mum's place` → "Mum's place".
 *
 * Increment 2 upgrades that fallback to Apple's `itemN.X-ABLABEL` form, which is
 * what iOS Contacts itself reads. This spelling loses nothing on the way back
 * *through us*; it is only iOS that will not show it as a custom label.
 */
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

/**
 * The `TYPE` param for a label, or none at all.
 *
 * "Other" is written as *nothing*: `labelFrom` returns it when a property has no
 * usable type, so an absent `TYPE` already round-trips to "Other" — and `OTHER`
 * is in the parser's own `TYPE_NOISE`, so writing it would be a line that says
 * nothing and reads back the same.
 */
function labelParams(
  label: string,
  known: Record<string, string>,
): Param[] | undefined {
  if (label === "Other") return undefined;
  return [{ key: "TYPE", value: known[label] ?? label }];
}

function telLine(phone: ParsedPhone): Line {
  const params = labelParams(phone.label, PHONE_TYPE_FOR_LABEL) ?? [];
  // `smsCapable: false` *is* a fax line — the parser derives the flag as
  // `!types.includes("FAX")`, so this is that expression inverted, not a second
  // opinion about what the flag means.
  if (!phone.smsCapable && !params.some((p) => p.value === "FAX")) {
    params.push({ key: "TYPE", value: "FAX" });
  }
  // Two facts vCard's `TEL` has nowhere to put. Both are parameters rather than
  // properties of their own so they ride the number they qualify and cannot be
  // separated from it.
  if (phone.extension !== null) {
    params.push({ key: "X-LEAPSAKE-EXT", value: phone.extension });
  }
  if (phone.country !== null) {
    params.push({ key: "X-LEAPSAKE-COUNTRY", value: phone.country });
  }
  return { name: "TEL", params, value: phone.number };
}

/**
 * `ADR` is `PO Box; Extended; Street; Locality; Region; Postal; Country`.
 *
 * **`line1` is the *street* slot (index 2) and `line2` the *extended* slot
 * (index 1)** — the inverse of the order `mapAddress` falls back through when
 * reading, and the single easiest thing in this file to get wrong. Written the
 * other way round, every address round-trips shifted by one field and nothing
 * fails loudly.
 *
 * The country component stays **empty**: it is a free-text name in a locale we
 * would have to invent, and the ISO code we actually hold goes in the sibling
 * `X-ABADR` the caller writes, which is the only spelling `countryCode` accepts.
 */
function adrLine(postal: ParsedPostal, group: string | null): Line {
  return {
    group,
    name: "ADR",
    params: labelParams(postal.label, POSTAL_TYPE_FOR_LABEL),
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

/**
 * A social profile as `X-SOCIALPROFILE` — Apple's property, and the one the
 * parser reads a `X-SERVICE-TYPE` off. The value is the profile URL when we have
 * one (that is what makes an unrecognised platform openable at all) and the bare
 * handle otherwise.
 */
function socialLine(social: ParsedSocial): Line {
  const params: Param[] = [
    { key: "X-SERVICE-TYPE", value: social.platform },
    ...(labelParams(social.label, SOCIAL_TYPE_FOR_LABEL) ?? []),
  ];
  if (social.platformUserId !== null) {
    params.push({ key: "X-LEAPSAKE-USERID", value: social.platformUserId });
  }
  return {
    name: "X-SOCIALPROFILE",
    params,
    value: social.url ?? social.handle,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * A partial civil date as a vCard date value, or `null` when there is no date.
 *
 * Three spellings, each settled by measurement rather than by the standard alone
 * (`plans/export.md` → *Writing dates*, verified on a real iPhone):
 *
 * - full date → **extended** `1985-04-12`, the form Apple emits itself and the
 *   one a human reading the backup can parse;
 * - no year → **basic** `--0412`, because RFC 6350's ABNF is `"--" month [day]`
 *   with no separator, so it is what a strict parser takes and a lenient one
 *   takes anyway (iOS accepts both);
 * - year only → `1985`.
 *
 * **It never emits `X-APPLE-OMIT-YEAR` or a placeholder year**, and there is a
 * test asserting exactly that. Apple's convention spells "no year" as
 * `BDAY;X-APPLE-OMIT-YEAR=1604:1604-04-12`, which any consumer that does not
 * know the parameter reads as *a person born in 1604* — data invented silently
 * and then synced onward attached to a real person. `--0412` merely loses the
 * year, visibly, and iOS reads it correctly. This is the same judgment
 * `parseDateValue` already documents from the reading side, and it is precisely
 * what a well-meaning "improve Apple compatibility" change reintroduces later.
 */
export function formatPartialDate(date: ParsedPartialDate): string | null {
  const { year, month, day } = date;
  if (month !== null) {
    const md = `${pad(month)}${day === null ? "" : pad(day)}`;
    if (year === null) return `--${md}`;
    return day === null
      ? `${pad4(year)}-${pad(month)}`
      : `${pad4(year)}-${pad(month)}-${pad(day)}`;
  }
  // No month means no day either (the day⇒month rule both the schema and
  // `parsePartialDate` enforce), so a year is all that is left to say.
  return year === null ? null : pad4(year);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * A timestamp as `REV` (RFC 6350 §6.7.4) — `2026-09-07T01:35:00Z`, extended and
 * to the second. Extended for the same reason full dates are, and seconds
 * because milliseconds are storage precision, not a fact about the record.
 */
export function formatTimestamp(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------------------
// Lines, params, escaping
// ---------------------------------------------------------------------------

interface Param {
  key: string;
  value: string;
}

interface Line {
  group?: string | null;
  name: string;
  params?: Param[];
  /** Raw, **already escaped** when `structured` — see {@link joinStructured}. */
  value: string;
  /** The value is a composite whose separators must survive escaping. */
  structured?: boolean;
}

/** `itemN.` for the next group on this card, 1-based like Apple's own output. */
function nextGroup(lines: readonly Line[]): string {
  const used = new Set(
    lines.map((l) => l.group).filter((g): g is string => g != null),
  );
  return `item${used.size + 1}`;
}

function renderLine(line: Line): string {
  const params = (line.params ?? [])
    .map((p) => `;${p.key}=${writeParam(p.value)}`)
    .join("");
  const name = line.group == null ? line.name : `${line.group}.${line.name}`;
  const value = line.structured ? line.value : escapeValue(line.value);
  return `${foldLine(`${name}${params}:${value}`)}\r\n`;
}

/**
 * Escape a text value: `\` first (or the escapes we add would be re-escaped),
 * then the two separators and the newline.
 *
 * `:` is deliberately **not** escaped — RFC 6350 says a colon in a value needs
 * no escape, and the parser splits on the first *unquoted* colon in the header
 * half only, so one in the value is already safe.
 */
function escapeValue(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/**
 * Join the components of a structured value (`N`, `ADR`), escaping each one and
 * joining on a **raw** `;` — the inverse of `splitStructured`, which splits on
 * unescaped semicolons and unescapes each component separately.
 */
function joinStructured(parts: readonly string[]): string {
  return parts.map(escapeValue).join(";");
}

/**
 * A parameter value, quoted only when it has to be.
 *
 * `parseProperty` splits the header on unquoted `;`, splits a param's values on
 * unquoted `,`, and finds the value at the first unquoted `:` — so those three
 * characters, and nothing else, force quoting. A `"` inside a param value has no
 * escape in vCard at all; it is dropped rather than written, since emitting it
 * would end the quoted run early and silently corrupt every param after it.
 */
function writeParam(value: string): string {
  const clean = value.replace(/"/g, "");
  return /[;:,]/.test(clean) ? `"${clean}"` : clean;
}

/**
 * Fold a logical line to {@link FOLD_OCTETS} octets per physical line,
 * continuations prefixed with a single space — the inverse of `unfold`, which
 * strips exactly one leading space or tab.
 *
 * **The count is octets, not characters**, and a fold must never land inside a
 * UTF-8 sequence: a continuation byte begins `10xxxxxx`, so the break walks back
 * to the nearest lead byte. Splitting mid-sequence produces two invalid halves
 * that no decoder can rejoin, which is the classic vCard corruption and the
 * reason a test drives a name of astral-plane characters through here.
 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= FOLD_OCTETS) return line;

  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // The first physical line gets the full width; every continuation spends one
    // octet on the leading space that marks it as one.
    const width = start === 0 ? FOLD_OCTETS : FOLD_OCTETS - 1;
    let end = Math.min(start + width, bytes.length);
    // Walk back off a continuation byte (`10xxxxxx`) so `end` always starts a
    // character. The end of the buffer is already a boundary, so it is left be.
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
