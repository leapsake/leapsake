import {
  type Gender,
  type MilestoneKind,
  type RelationshipRole,
  isMilestoneKind,
  kindDefs,
  roleDefs,
} from "@leapsake/schema";
import type {
  DroppedField,
  ParsedBirthday,
  ParsedContact,
  ParsedDate,
  ParsedEmail,
  ParsedName,
  ParsedPartialDate,
  ParsedPhone,
  ParsedPostal,
  ParsedRelated,
  ParsedSocial,
} from "./parsed-contact.js";
import { PLATFORMS, bareHandle, findPlatform } from "@leapsake/contact-links";
import { appleLabelText, dateKindFor } from "./apple-labels.js";

// The vCard reader: v2.1, 3.0 and 4.0, liberally. Anything unmapped goes to
// `dropped` for the review; see the README's _Parse liberally_.

/** The formats the importer recognises, as a union new formats extend. */
export type DetectedFormat = { format: "vcard" } | { format: "unknown" };

/** Longest a dropped value is kept: recognisable, but no base64 photo. */
const DROPPED_VALUE_CAP = 300;

/** vCard properties this reader maps to real Leapsake fields. */
const HANDLED = new Set([
  "N",
  "FN",
  "EMAIL",
  "TEL",
  "ADR",
  "BDAY",
  "ANNIVERSARY",
  "GENDER",
  "RELATED",
  "IMPP",
  "X-SOCIALPROFILE",
  "URL",
  // Apple's labelled date, and the grouped label and address country that
  // other properties consume, so neither is ever dropped.
  "X-ABDATE",
  "X-ABLABEL",
  "X-ABADR",
  // The card's own identity, and the tags it carries.
  "UID",
  "KIND",
  "REV",
  "CATEGORIES",
  "X-LEAPSAKE-SELF",
  "X-LEAPSAKE-CREATED",
]);

/** `RELATED;TYPE=` to a role; an unmapped word becomes an `other` note. */
const RELATED_ROLES: Record<string, RelationshipRole> = {
  spouse: "spouse",
  child: "child",
  parent: "parent",
  sibling: "sibling",
  friend: "friend",
  neighbor: "neighbor",
  "co-worker": "coworker",
  colleague: "coworker",
};

/** Whether a `RELATED` value is a URI rather than a plain name. */
function isReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value.trim());
}

/** One `RELATED` as a relation, named or pointing at a card in `namesByUid`;
 *  `null` when it names nobody this file holds. */
function relatedFrom(
  p: Property,
  namesByUid: Map<string, string>,
): ParsedRelated | null {
  const value = unescapeValue(p.value).trim();
  if (value === "") return null;

  // A reference takes its name from the card it names; one to a card not in
  // this file stays in `dropped`.
  let otherUid: string | null = null;
  let name = value;
  if (isReference(value)) {
    const uuid = /^urn:uuid:/i.test(value) ? parseUid(value) : null;
    const resolved = uuid === null ? undefined : namesByUid.get(uuid);
    if (uuid === null || resolved === undefined) return null;
    otherUid = uuid;
    name = resolved;
  }

  const relationshipId = paramValue(p, "X-LEAPSAKE-REL-ID");
  const exact = paramValue(p, "X-LEAPSAKE-ROLE");

  // Our own card's exact role beats the standard `TYPE`.
  if (exact !== null && exact in roleDefs) {
    const role = exact as RelationshipRole;
    return {
      name,
      // Only `other` has a note, read raw since `typesOf` upper-cases.
      roleNote: role === "other" ? rawNote(p) : null,
      role,
      otherUid,
      relationshipId,
    };
  }

  const types = typesOf(p).map((t) => t.toLowerCase());
  const known = types.find((t) => t in RELATED_ROLES);
  if (known !== undefined) {
    return {
      name,
      role: RELATED_ROLES[known],
      roleNote: null,
      otherUid,
      relationshipId,
    };
  }
  // An unmapped `TYPE` is the note; with none, the note is “related”.
  const note = types.find((t) => !TYPE_NOISE.has(t.toUpperCase())) ?? "related";
  return { name, role: "other", roleNote: note, otherUid, relationshipId };
}

/** The first non-noise `TYPE` in the card's own casing, or `null`. */
function rawNote(p: Property): string | null {
  const raw = (p.params.get("TYPE") ?? []).find(
    (t) => !TYPE_NOISE.has(t.trim().toUpperCase()),
  );
  return raw === undefined ? null : nullIfEmpty(raw.trim());
}

/** Structural properties, ignored rather than surfaced as dropped. */
const STRUCTURAL = new Set([
  "BEGIN",
  "END",
  "VERSION",
  "PRODID",
  "SOURCE",
  "PROFILE",
]);

/** A parsed physical property line: `[group.]NAME;PARAM=v;PARAM=v:VALUE`. */
interface Property {
  name: string; // upper-cased, group prefix stripped
  group: string | null; // lower-cased `item1.` prefix, or null when ungrouped
  params: Map<string, string[]>; // upper-cased KEY; bare types under "TYPE"
  value: string; // raw, still escaped
}

/** Detects a vCard by its `BEGIN:VCARD` content, else a `.vcf` name, so a
 *  mislabelled file still imports. */
export function detectContactFormat(input: {
  text: string;
  filename?: string;
}): DetectedFormat {
  const text = stripBom(input.text);
  if (/(^|[\r\n])\s*BEGIN:VCARD/i.test(text)) return { format: "vcard" };
  if (input.filename && /\.vcf$/i.test(input.filename.trim())) {
    return { format: "vcard" };
  }
  return { format: "unknown" };
}

/** Parses every `BEGIN:VCARD` block in `text` into a ParsedContact. */
export function parseVCards(text: string): ParsedContact[] {
  const lines = unfold(stripBom(text));
  const cards: Property[][] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      current = [];
      continue;
    }
    if (upper.startsWith("END:VCARD")) {
      if (current) cards.push(current);
      current = null;
      continue;
    }
    if (current === null) continue; // stray line outside a card
    const prop = parseProperty(line);
    if (prop) current.push(prop);
  }

  // Every card's `UID` to `FN` first, so a `RELATED` reference resolves
  // whichever order the cards arrive in.
  const namesByUid = new Map<string, string>();
  for (const props of cards) {
    const uid = uidOf(props);
    const fn = displayNameOf(props);
    if (uid !== null && fn !== null) namesByUid.set(uid, fn);
  }
  return cards.map((props) => buildContact(props, namesByUid));
}

/** A card's `UID` without its `urn:uuid:` prefix. */
function uidOf(props: Property[]): string | null {
  const p = props.find((prop) => prop.name === "UID");
  return p === undefined ? null : parseUid(p.value);
}

function displayNameOf(props: Property[]): string | null {
  const p = props.find((prop) => prop.name === "FN");
  return p === undefined ? null : nullIfEmpty(unescapeValue(p.value).trim());
}

/** `urn:uuid:<id>` to `<id>`; any other spelling kept as it came. */
function parseUid(raw: string): string | null {
  const value = unescapeValue(raw).trim();
  return nullIfEmpty(value.replace(/^urn:uuid:/i, "").trim());
}

// Line handling

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Unfolds continuation lines into whole property lines, dropping blanks. */
function unfold(text: string): string[] {
  const physical = text.split(/\r\n|\r|\n/);
  const logical: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && logical.length > 0) {
      logical[logical.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      logical.push(line);
    }
  }
  return logical;
}

/** Splits a property line at its first unquoted colon; `null` if none. */
function parseProperty(line: string): Property | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon === -1) return null;
  const header = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments = splitUnquoted(header, ";");
  let rawName = segments[0] ?? "";
  // The group is kept: it ties `item2.X-ABDATE` to `item2.X-ABLabel`.
  const dot = rawName.indexOf(".");
  let group: string | null = null;
  if (dot !== -1) {
    group = rawName.slice(0, dot).toLowerCase();
    rawName = rawName.slice(dot + 1);
  }
  const name = rawName.toUpperCase();

  const params = new Map<string, string[]>();
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq === -1) {
      // vCard 2.1 bare type, e.g. `;HOME;VOICE` — record under TYPE.
      pushParam(params, "TYPE", [unquote(seg)]);
    } else {
      const key = seg.slice(0, eq).toUpperCase();
      const values = splitUnquoted(seg.slice(eq + 1), ",").map(unquote);
      pushParam(params, key, values);
    }
  }
  return { name, group, params, value };
}

function pushParam(
  params: Map<string, string[]>,
  key: string,
  values: string[],
): void {
  const existing = params.get(key);
  if (existing) existing.push(...values);
  else params.set(key, values);
}

/** Index of the first `char` not inside a double-quoted run, or -1. */
function indexOfUnquoted(s: string, char: string): number {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (c === char && !quoted) return i;
  }
  return -1;
}

/** Splits on `sep` outside double quotes, for parameters. */
function splitUnquoted(s: string, sep: string): string[] {
  const out: string[] = [];
  let quoted = false;
  let buf = "";
  for (const c of s) {
    if (c === '"') {
      quoted = !quoted;
      buf += c;
    } else if (c === sep && !quoted) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

function unquote(s: string): string {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2
    ? t.slice(1, -1)
    : t;
}

// Value escaping

/** Unescapes a text value: `\n` to newline, any other escape to its literal. */
function unescapeValue(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      const next = s[++i];
      if (next === "n" || next === "N") out += "\n";
      else out += next; // \, \; \\ and any other escaped char → literal
    } else {
      out += c;
    }
  }
  return out;
}

/** Splits on an unescaped delimiter: `;` for `N` and `ADR`, `,` for lists. */
function splitStructured(value: string, delimiter = ";"): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      buf += c + value[++i]; // keep the escape pair; unescape happens per-field
    } else if (c === delimiter) {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

/** Component `i` of a structured value, unescaped and trimmed, or `""`. */
function component(parts: string[], i: number): string {
  return parts[i] !== undefined ? unescapeValue(parts[i]).trim() : "";
}

function nullIfEmpty(s: string): string | null {
  return s === "" ? null : s;
}

// Field mapping

function buildContact(
  props: Property[],
  namesByUid: Map<string, string>,
): ParsedContact {
  const emails: ParsedEmail[] = [];
  const phones: ParsedPhone[] = [];
  const postals: ParsedPostal[] = [];
  const socials: ParsedSocial[] = [];
  const related: ParsedRelated[] = [];
  const dates: ParsedDate[] = [];
  const dropped: DroppedField[] = [];
  let tags: string[] = [];
  let nParts: string[] | null = null;
  let fn: string | null = null;
  let gender: Gender | null = null;
  let uid: string | null = null;
  let kind: "individual" | "pet" = "individual";
  let isSelf = false;
  let createdAt: number | null = null;
  let updatedAt: number | null = null;
  let birthday: ParsedBirthday | null = null;
  // A birthday-labelled date, used after the loop only if `BDAY` is absent.
  let labelledBirthday: ParsedBirthday | null = null;

  // Grouped labels and countries first, since sibling lines come in any order.
  const groupLabels = new Map<string, string>();
  const groupCountries = new Map<string, string>();
  for (const p of props) {
    if (p.group === null) continue;
    if (p.name === "X-ABLABEL") {
      groupLabels.set(p.group, appleLabelText(unescapeValue(p.value)));
    } else if (p.name === "X-ABADR") {
      groupCountries.set(p.group, unescapeValue(p.value).trim());
    }
  }

  for (const p of props) {
    // The user's own word for this property, from Apple's grouped `X-ABLABEL`.
    const groupLabel = p.group === null ? "" : (groupLabels.get(p.group) ?? "");

    switch (p.name) {
      case "N":
        nParts = splitStructured(p.value);
        break;
      case "FN":
        fn = nullIfEmpty(unescapeValue(p.value).trim());
        break;
      // Our `urn:uuid:` prefix comes off; any other form is kept verbatim.
      case "UID":
        uid = parseUid(p.value);
        break;
      // A pet is `KIND:x-pet`; any other kind reads as a person.
      case "KIND":
        kind =
          unescapeValue(p.value).trim().toLowerCase() === "x-pet"
            ? "pet"
            : "individual";
        break;
      // Split on raw commas only, so a tag holding an escaped comma stays one.
      case "CATEGORIES":
        tags = splitStructured(p.value, ",")
          .map((t) => unescapeValue(t).trim())
          .filter((t) => t !== "");
        break;
      case "X-LEAPSAKE-SELF":
        isSelf = unescapeValue(p.value).trim().toUpperCase() === "TRUE";
        break;
      case "X-LEAPSAKE-CREATED":
        createdAt = parseTimestamp(unescapeValue(p.value));
        break;
      case "REV":
        updatedAt = parseTimestamp(unescapeValue(p.value));
        break;
      case "EMAIL": {
        const address = unescapeValue(p.value).trim();
        if (address !== "") {
          emails.push({ label: emailLabel(typesOf(p), groupLabel), address });
        }
        break;
      }
      case "TEL": {
        const number = unescapeValue(p.value).trim();
        if (number !== "") {
          const types = typesOf(p);
          phones.push({
            label: phoneLabel(types, groupLabel),
            number,
            // Our own parameters; `null` on a foreign card.
            extension: paramValue(p, "X-LEAPSAKE-EXT"),
            country: paramValue(p, "X-LEAPSAKE-COUNTRY"),
            smsCapable: !types.includes("FAX"),
          });
        }
        break;
      }
      case "ADR": {
        const postal = mapAddress(
          splitStructured(p.value),
          typesOf(p),
          p.group === null ? null : (groupCountries.get(p.group) ?? null),
          dropped,
          groupLabel,
        );
        if (postal) postals.push(postal);
        break;
      }
      case "IMPP":
      case "X-SOCIALPROFILE": {
        const social = socialFrom(p, groupLabel);
        // A value naming no service stays in the review's “not imported”.
        if (social) socials.push(social);
        else dropField(dropped, p.name, p.value);
        break;
      }
      case "URL": {
        // A `URL` is a social profile only when its host names a platform;
        // anything else is dropped.
        const social = socialFrom(p, groupLabel);
        if (social && findPlatform(social.platform)) socials.push(social);
        else dropField(dropped, "URL", p.value);
        break;
      }
      case "BDAY": {
        const parsed = parseDateValue(p);
        if (parsed) birthday = parsed;
        else dropField(dropped, "BDAY", p.value);
        break;
      }
      // A wedding anniversary; with no spouse named, it lands on the person.
      case "ANNIVERSARY": {
        const parsed = parseDateValue(p);
        if (parsed) {
          dates.push({
            kind: "wedding",
            label: kindDefs.wedding.label,
            date: parsed,
            note: null,
            id: null,
            relationshipId: null,
          });
        } else dropField(dropped, "ANNIVERSARY", p.value);
        break;
      }
      // Apple's dated occasion: our own card names its kind outright; a
      // foreign one goes through {@link dateKindFor}, as on the device.
      case "X-ABDATE": {
        const parsed = parseDateValue(p);
        const exact = milestoneKindParam(p);
        // With a kind but no `X-ABLABEL`, the kind's label stands in, since
        // `ParsedDate.label` may never be empty.
        const group = p.group === null ? "" : (groupLabels.get(p.group) ?? "");
        const text =
          group !== "" || exact === null ? group : kindDefs[exact].label;
        if (parsed === null || text === "") {
          dropField(dropped, "X-ABDATE", p.value);
          break;
        }
        // ⚠️ Ahead of the birthday rule below, or our second birthday-kind
        // milestone would be swallowed by `labelledBirthday`.
        if (exact !== null) {
          dates.push({
            kind: exact,
            label: text,
            date: parsed,
            // An `other` recovers its note from the label, unless the label is
            // “Other” itself, which a note-less `other` is written as.
            note: noteFor(p, exact, text),
            // The file's ids, for matching halves; never used as row ids.
            id: paramValue(p, "X-LEAPSAKE-MILESTONE-ID"),
            relationshipId: paramValue(p, "X-LEAPSAKE-MILESTONE-REL"),
          });
          break;
        }
        if (text.toLowerCase() === "birthday") {
          labelledBirthday ??= parsed;
          break;
        }
        const kind = dateKindFor(text);
        if (kind === null) {
          dropField(dropped, `Date (${text})`, p.value);
          break;
        }
        dates.push({
          kind,
          label: text,
          date: parsed,
          note: null,
          id: null,
          relationshipId: null,
        });
        break;
      }
      case "GENDER":
        gender = parseGender(p.value);
        break;
      case "RELATED": {
        const relation = relatedFrom(p, namesByUid);
        // An unresolvable reference stays in the review's “not imported”.
        if (relation) related.push(relation);
        else dropField(dropped, "RELATED", p.value);
        break;
      }
      default:
        if (!STRUCTURAL.has(p.name) && !HANDLED.has(p.name)) {
          dropField(dropped, p.name, p.value);
        }
    }
  }

  return {
    // A matching key, never the id of the row an import creates.
    uid,
    kind,
    isSelf,
    // Read, but not applied: an imported entity is stamped when imported.
    createdAt,
    updatedAt,
    name: deriveName(nParts, fn),
    displayName: fn,
    gender,
    emails,
    phones,
    postals,
    socials,
    birthday: birthday ?? labelledBirthday,
    dates,
    related,
    tags,
    dropped,
  };
}

/** First, middle and last from `N`, else from splitting `FN`; a single token
 *  leaves `lastName` empty rather than inventing one. */
function deriveName(nParts: string[] | null, fn: string | null): ParsedName {
  const family = nParts ? component(nParts, 0) : "";
  const given = nParts ? component(nParts, 1) : "";
  const additional = nParts ? component(nParts, 2) : "";

  if (given !== "") {
    return {
      firstName: given,
      middleName: nullIfEmpty(additional),
      lastName: family,
    };
  }

  const tokens = fn ? fn.split(/\s+/).filter((t) => t !== "") : [];
  if (tokens.length >= 2) {
    return {
      firstName: tokens[0],
      middleName: null,
      lastName: tokens.slice(1).join(" "),
    };
  }
  if (tokens.length === 1) {
    // A lone token equal to the family name is a surname-only person, as we
    // write one, so it fills only the last name.
    const first = tokens[0] === family ? "" : tokens[0];
    return { firstName: first, middleName: null, lastName: family };
  }
  return {
    firstName: "",
    middleName: nullIfEmpty(additional),
    lastName: family,
  };
}

function mapAddress(
  parts: string[],
  types: string[],
  isoHint: string | null,
  dropped: DroppedField[],
  groupLabel = "",
): ParsedPostal | null {
  // ADR: PO Box; Extended; Street; Locality; Region; Postal; Country.
  const poBox = component(parts, 0);
  const extended = component(parts, 1);
  const street = component(parts, 2);
  const locality = component(parts, 3);
  const region = component(parts, 4);
  const postalCode = component(parts, 5);
  const countryRaw = component(parts, 6);

  // line1 must be non-empty (schema requires it); fall back through the parts.
  const line1 = street || poBox || extended;
  if (line1 === "") return null;
  const line2 = street ? nullIfEmpty(extended || poBox) : null;

  const country = countryCode(countryRaw, isoHint);
  // A country name with no code is reported as dropped; with one, it is not.
  if (country === null && countryRaw !== "") {
    dropField(dropped, "ADR country", countryRaw);
  }

  return {
    label: postalLabel(types, groupLabel),
    line1,
    line2,
    locality: nullIfEmpty(locality),
    region: nullIfEmpty(region),
    postalCode: nullIfEmpty(postalCode),
    country,
  };
}

/** An address's ISO 3166-1 alpha-2 country: `ADR`'s own if it is a code, else
 *  Apple's grouped `X-ABADR`; never mapped from a name. */
function countryCode(
  countryRaw: string,
  isoHint: string | null,
): string | null {
  for (const candidate of [countryRaw, isoHint ?? ""]) {
    const iso = candidate.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(iso)) return iso;
  }
  return null;
}

/** A date property as a partial date, dropping the placeholder year Apple
 *  names in `X-APPLE-OMIT-YEAR` when it matches the value's. */
function parseDateValue(p: Property): ParsedPartialDate | null {
  const parsed = parsePartialDate(unescapeValue(p.value).trim());
  if (parsed === null || parsed.year === null) return parsed;
  const omitted = p.params.get("X-APPLE-OMIT-YEAR")?.[0];
  if (omitted === undefined) return parsed;
  return Number.parseInt(omitted, 10) === parsed.year
    ? { ...parsed, year: null }
    : parsed;
}

/** A basic, extended, year-less or year-only date value, or a date-time's
 *  date, as a partial date; a lone day is dropped. */
function parsePartialDate(raw: string): ParsedPartialDate | null {
  const dateOnly = raw.split("T")[0].trim();
  if (dateOnly === "") return null;

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  if (dateOnly.startsWith("--")) {
    const digits = dateOnly.slice(2).replace(/-/g, "");
    if (digits.length >= 2) month = toInt(digits.slice(0, 2));
    if (digits.length >= 4) day = toInt(digits.slice(2, 4));
  } else {
    const digits = dateOnly.replace(/-/g, "");
    if (digits.length >= 4) year = toInt(digits.slice(0, 4));
    if (digits.length >= 6) month = toInt(digits.slice(4, 6));
    if (digits.length >= 8) day = toInt(digits.slice(6, 8));
  }

  if (month !== null && (month < 1 || month > 12)) month = null;
  if (day !== null && (day < 1 || day > 31)) day = null;
  if (month === null) day = null; // day⇒month

  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

/** A timestamp as epoch ms, or `null`; `Date.parse` suits an instant, where a
 *  civil date must never shift by a timezone. */
function parseTimestamp(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : ms;
}

function parseGender(raw: string): Gender | null {
  // GENDER is `sex[;identity]`; we read the single-letter sex component.
  const sex = raw.split(";")[0].trim().toUpperCase();
  if (sex === "M") return "male";
  if (sex === "F") return "female";
  if (sex === "O" || sex === "N") return "nonbinary";
  return null;
}

function toInt(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

// TYPE to label mapping

/** All `TYPE=` values on a property, upper-cased (bare 2.1 types included). */
function typesOf(p: Property): string[] {
  return (p.params.get("TYPE") ?? []).map((t) => t.toUpperCase());
}

/** A single-valued parameter, or `null`: how `X-LEAPSAKE-*` facts are read. */
function paramValue(p: Property, key: string): string | null {
  const value = p.params.get(key)?.[0];
  return value === undefined ? null : nullIfEmpty(value.trim());
}

/** A milestone's note: its parameter, or for `other` the label itself. */
function noteFor(
  p: Property,
  kind: MilestoneKind,
  label: string,
): string | null {
  const note = paramValue(p, "X-LEAPSAKE-MILESTONE-NOTE");
  if (note !== null) return note;
  if (kind !== "other" || label === kindDefs.other.label) return null;
  return label;
}

/** The kind our own card names outright, or `null`; an unknown kind, from a
 *  newer Leapsake, falls back to the label. */
function milestoneKindParam(p: Property): MilestoneKind | null {
  const raw = paramValue(p, "X-LEAPSAKE-MILESTONE-KIND");
  return raw !== null && isMilestoneKind(raw) ? raw : null;
}

/** Parameter noise that is never a user-facing label. */
const TYPE_NOISE = new Set(["INTERNET", "PREF", "VOICE", "OTHER"]);

function emailLabel(types: string[], groupLabel = ""): string {
  return labelFrom(types, { HOME: "Home", WORK: "Work" }, groupLabel);
}

function phoneLabel(types: string[], groupLabel = ""): string {
  return labelFrom(
    types,
    {
      CELL: "Mobile",
      MOBILE: "Mobile",
      IPHONE: "Mobile",
      HOME: "Home",
      WORK: "Work",
      FAX: "Fax",
      MAIN: "Main",
    },
    groupLabel,
  );
}

function postalLabel(types: string[], groupLabel = ""): string {
  return labelFrom(types, { HOME: "Home", WORK: "Work" }, groupLabel);
}

/** Source words for a network that differ from its platform id or name. */
const PLATFORM_ALIASES: Record<string, string> = {
  twitter: "x",
  messenger: "facebook",
  fb: "facebook",
  ig: "instagram",
  insta: "instagram",
  bsky: "bluesky",
  "bluesky social": "bluesky",
  snap: "snapchat",
};

function platformIdFor(raw: string): string {
  const word = raw.trim().toLowerCase();
  if (word === "") return "";
  if (PLATFORM_ALIASES[word]) return PLATFORM_ALIASES[word];
  const match = PLATFORMS.find(
    (p) => p.id === word || p.name.toLowerCase() === word,
  );
  return match?.id ?? word;
}

/** An `IMPP` or `X-SOCIALPROFILE` as a {@link ParsedSocial}, keeping a URL
 *  whole too; `null` when it names no service. */
function socialFrom(p: Property, groupLabel = ""): ParsedSocial | null {
  const value = unescapeValue(p.value).trim();
  if (value === "") return null;

  const serviceParam =
    p.params.get("X-SERVICE-TYPE")?.[0] ??
    typesOf(p).find((t) => !TYPE_NOISE.has(t) && t !== "HOME" && t !== "WORK");

  // An `IMPP` URI's scheme names the service when no parameter does.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  const scheme = schemeMatch?.[1]?.toLowerCase();
  const isWebUrl = scheme === "http" || scheme === "https";

  const platform = platformIdFor(
    serviceParam ?? (isWebUrl ? hostWord(value) : (scheme ?? "")),
  );
  if (platform === "") return null;

  // Strip a non-web scheme (`xmpp:josh@host`) before handing the rest to the
  // handle cleaner, which only knows how to unwrap URLs and `@` prefixes.
  const rest =
    scheme !== undefined && !isWebUrl ? value.slice(scheme.length + 1) : value;

  return {
    label: labelFrom(
      typesOf(p),
      { HOME: "Personal", WORK: "Work" },
      groupLabel,
    ),
    platform,
    handle: bareHandle(rest.replace(/^\/\//, "")),
    url: isWebUrl ? value : null,
    // Only our own cards carry the opaque account id.
    platformUserId: paramValue(p, "X-LEAPSAKE-USERID"),
  };
}

/** The registrable word of a URL's host: `www.instagram.com` is `instagram`. */
function hostWord(url: string): string {
  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? "";
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  return parts[0] ?? "";
}

/** A never-empty label: the unwrapped `groupLabel`, else the first known
 *  `TYPE`, else the first non-noise one, else “Other”. */
function labelFrom(
  types: string[],
  known: Record<string, string>,
  groupLabel = "",
): string {
  if (groupLabel !== "") return groupLabel;
  for (const t of types) {
    if (known[t]) return known[t];
  }
  for (const t of types) {
    if (!TYPE_NOISE.has(t) && t !== "") return titleCase(t);
  }
  return "Other";
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// Dropped fields

function dropField(
  dropped: DroppedField[],
  property: string,
  raw: string,
): void {
  // A PHOTO or LOGO is recorded by presence, not its base64 payload.
  const value =
    property === "PHOTO" || property === "LOGO"
      ? "(embedded image)"
      : cap(unescapeValue(raw).trim());
  if (value !== "") dropped.push({ property, value });
}

function cap(s: string): string {
  return s.length > DROPPED_VALUE_CAP ? `${s.slice(0, DROPPED_VALUE_CAP)}…` : s;
}
