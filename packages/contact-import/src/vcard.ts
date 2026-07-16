import type { Gender } from "@leapsake/schema";
import type {
  DroppedField,
  ParsedBirthday,
  ParsedContact,
  ParsedEmail,
  ParsedName,
  ParsedPhone,
  ParsedPostal,
} from "./parsed-contact.js";

/**
 * A hand-rolled vCard reader — parse-only, no dependency. vCard is a simple
 * line-oriented format (RFC 6350 / RFC 2426), and this repo already hand-rolls
 * its civil-date math and migration runner rather than pulling libraries; a
 * parse-only reader for the handful of properties Leapsake maps is well within
 * that grain and keeps the renderer bundle lean. It tolerates the real-world
 * spread of exports (Apple, Google, Outlook): v2.1/3.0/4.0, folded lines,
 * grouped properties, quoted parameters, `TYPE=` labels, and partial `BDAY`s.
 *
 * Anything Leapsake has no column for (NOTE, ORG, PHOTO, a free-text address
 * country, …) is routed to `dropped` for the review UI rather than discarded, so
 * the user always sees what will not be imported.
 */

/** The set of formats the importer can recognise. A discriminated union so new
 *  formats (CSV, LDIF) slot in as extra branches without touching callers. */
export type DetectedFormat = { format: "vcard" } | { format: "unknown" };

/** Longest a surfaced "dropped" value is kept — enough to be recognisable in the
 *  review UI without shipping a whole base64 photo across IPC. */
const DROPPED_VALUE_CAP = 300;

/** vCard properties this reader maps to real Leapsake fields. */
const HANDLED = new Set(["N", "FN", "EMAIL", "TEL", "ADR", "BDAY", "GENDER"]);

/** Structural / metadata properties that are neither mapped nor user-visible
 *  data — silently ignored (not surfaced as "dropped"). */
const STRUCTURAL = new Set([
  "BEGIN",
  "END",
  "VERSION",
  "PRODID",
  "REV",
  "UID",
  "SOURCE",
  "KIND",
  "PROFILE",
]);

/** A parsed physical property line: `[group.]NAME;PARAM=v;PARAM=v:VALUE`. */
interface Property {
  name: string; // upper-cased, group prefix stripped
  params: Map<string, string[]>; // KEY (upper) -> values; bare types under "TYPE"
  value: string; // raw, still escaped
}

/**
 * Detect whether a dropped file is a vCard, by content signature (`BEGIN:VCARD`,
 * tolerant of a BOM / leading whitespace) or a `.vcf` filename. Content wins, so
 * a mislabelled or extensionless file still imports; the union return type is the
 * seam future format detectors extend.
 */
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

/** Parse every `BEGIN:VCARD`…`END:VCARD` block in `text` into a ParsedContact. */
export function parseVCards(text: string): ParsedContact[] {
  const lines = unfold(stripBom(text));
  const contacts: ParsedContact[] = [];
  let current: Property[] | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      current = [];
      continue;
    }
    if (upper.startsWith("END:VCARD")) {
      if (current) contacts.push(buildContact(current));
      current = null;
      continue;
    }
    if (current === null) continue; // stray line outside a card
    const prop = parseProperty(line);
    if (prop) current.push(prop);
  }
  return contacts;
}

// ---------------------------------------------------------------------------
// Line handling
// ---------------------------------------------------------------------------

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Un-fold per RFC 6350 §3.2: a CRLF (or bare LF) followed by a single space or
 * tab continues the previous logical line. Splits on either line ending and drops
 * blank lines, so downstream only ever sees whole property lines.
 */
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

/**
 * Split one property line into its name+params half and its value at the first
 * **unquoted** colon (a quoted parameter value may itself contain a colon), then
 * parse the name (group prefix stripped) and parameters. Returns `null` for a
 * line with no colon.
 */
function parseProperty(line: string): Property | null {
  const colon = indexOfUnquoted(line, ":");
  if (colon === -1) return null;
  const header = line.slice(0, colon);
  const value = line.slice(colon + 1);

  const segments = splitUnquoted(header, ";");
  let rawName = segments[0] ?? "";
  const dot = rawName.indexOf("."); // strip an optional group prefix
  if (dot !== -1) rawName = rawName.slice(dot + 1);
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
  return { name, params, value };
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

/** Split on `sep` outside double quotes (parameter parsing, not value escapes). */
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

// ---------------------------------------------------------------------------
// Value escaping
// ---------------------------------------------------------------------------

/** Un-escape a vCard text value: `\n`/`\N` → newline, `\, \; \\` → the literal. */
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

/** Split a structured value (N, ADR) into components on **unescaped** `;`. */
function splitStructured(value: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      buf += c + value[++i]; // keep the escape pair; unescape happens per-field
    } else if (c === ";") {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

/** Component `i` of a structured value, un-escaped and trimmed; `""` if absent. */
function component(parts: string[], i: number): string {
  return parts[i] !== undefined ? unescapeValue(parts[i]).trim() : "";
}

function nullIfEmpty(s: string): string | null {
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

function buildContact(props: Property[]): ParsedContact {
  const emails: ParsedEmail[] = [];
  const phones: ParsedPhone[] = [];
  const postals: ParsedPostal[] = [];
  const dropped: DroppedField[] = [];
  let nParts: string[] | null = null;
  let fn: string | null = null;
  let gender: Gender | null = null;
  let birthday: ParsedBirthday | null = null;

  for (const p of props) {
    switch (p.name) {
      case "N":
        nParts = splitStructured(p.value);
        break;
      case "FN":
        fn = nullIfEmpty(unescapeValue(p.value).trim());
        break;
      case "EMAIL": {
        const address = unescapeValue(p.value).trim();
        if (address !== "") {
          emails.push({ label: emailLabel(typesOf(p)), address });
        }
        break;
      }
      case "TEL": {
        const number = unescapeValue(p.value).trim();
        if (number !== "") {
          const types = typesOf(p);
          phones.push({
            label: phoneLabel(types),
            number,
            extension: null,
            country: null, // vCard TEL carries no reliable ISO country
            smsCapable: !types.includes("FAX"),
          });
        }
        break;
      }
      case "ADR": {
        const postal = mapAddress(
          splitStructured(p.value),
          typesOf(p),
          dropped,
        );
        if (postal) postals.push(postal);
        break;
      }
      case "BDAY": {
        const parsed = parseBirthday(unescapeValue(p.value).trim());
        if (parsed) birthday = parsed;
        else dropField(dropped, "BDAY", p.value);
        break;
      }
      case "GENDER":
        gender = parseGender(p.value);
        break;
      default:
        if (!STRUCTURAL.has(p.name) && !HANDLED.has(p.name)) {
          dropField(dropped, p.name, p.value);
        }
    }
  }

  return {
    name: deriveName(nParts, fn),
    displayName: fn,
    gender,
    emails,
    phones,
    postals,
    birthday,
    dropped,
  };
}

/**
 * Derive first/middle/last. A structured `N` with a given name wins; otherwise
 * fall back to splitting `FN` (first token = first name, the rest = last name).
 * A single-token `FN` (mononym / organisation) leaves `lastName` empty — never
 * fabricated; the review UI makes the user supply it before import.
 */
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
    return { firstName: tokens[0], middleName: null, lastName: family };
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
  dropped: DroppedField[],
): ParsedPostal | null {
  // Structured ADR: PO Box; Extended; Street; Locality; Region; Postal; Country.
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

  // The schema's country is ISO-3166 alpha-2. Real cards put a free-text name
  // ("USA") here, which would be rejected — surface it as dropped instead.
  let country: string | null = null;
  const iso = countryRaw.toUpperCase();
  if (/^[A-Z]{2}$/.test(iso)) country = iso;
  else if (countryRaw !== "") dropField(dropped, "ADR country", countryRaw);

  return {
    label: postalLabel(types),
    line1,
    line2,
    locality: nullIfEmpty(locality),
    region: nullIfEmpty(region),
    postalCode: nullIfEmpty(postalCode),
    country,
  };
}

/**
 * Parse a `BDAY` into a partial civil date. Handles v4 basic `19920309`, extended
 * `1992-03-09`, year-less `--0309` / `--03-09`, year-only `1992`, and any leading
 * date of a date-time (`…T…`). Upholds day⇒month (a lone day is dropped). Returns
 * `null` when nothing usable is present.
 */
function parseBirthday(raw: string): ParsedBirthday | null {
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

// ---------------------------------------------------------------------------
// TYPE → label mapping
// ---------------------------------------------------------------------------

/** All `TYPE=` values on a property, upper-cased (bare 2.1 types included). */
function typesOf(p: Property): string[] {
  return (p.params.get("TYPE") ?? []).map((t) => t.toUpperCase());
}

/** Parameter noise that is never a user-facing label. */
const TYPE_NOISE = new Set(["INTERNET", "PREF", "VOICE", "OTHER"]);

function emailLabel(types: string[]): string {
  return labelFrom(types, { HOME: "Home", WORK: "Work" });
}

function phoneLabel(types: string[]): string {
  return labelFrom(types, {
    CELL: "Mobile",
    MOBILE: "Mobile",
    IPHONE: "Mobile",
    HOME: "Home",
    WORK: "Work",
    FAX: "Fax",
    MAIN: "Main",
  });
}

function postalLabel(types: string[]): string {
  return labelFrom(types, { HOME: "Home", WORK: "Work" });
}

/**
 * Turn a property's `TYPE`s into a display label: the first recognised type wins;
 * otherwise the first non-noise type, title-cased; otherwise "Other". Guarantees
 * a non-empty label (contact-method labels are `min(1)`).
 */
function labelFrom(types: string[], known: Record<string, string>): string {
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

// ---------------------------------------------------------------------------
// Dropped fields
// ---------------------------------------------------------------------------

function dropField(
  dropped: DroppedField[],
  property: string,
  raw: string,
): void {
  // PHOTO/LOGO values can be large embedded base64 — record their presence, not
  // the payload, so a review payload never balloons across IPC.
  const value =
    property === "PHOTO" || property === "LOGO"
      ? "(embedded image)"
      : cap(unescapeValue(raw).trim());
  if (value !== "") dropped.push({ property, value });
}

function cap(s: string): string {
  return s.length > DROPPED_VALUE_CAP ? `${s.slice(0, DROPPED_VALUE_CAP)}…` : s;
}
