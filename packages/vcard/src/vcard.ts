import type { Gender, RelationshipRole } from "@leapsake/schema";
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
  // Apple's own spelling of a labelled date, the grouped label that names it (and
  // names a custom `ADR`/`TEL`/`EMAIL` too), and the grouped ISO country code for
  // an address. The latter two are metadata *about* another property rather than
  // data of their own — like a `TYPE=` parameter — so they are consumed by the
  // property they describe, never surfaced as dropped.
  "X-ABDATE",
  "X-ABLABEL",
  "X-ABADR",
]);

/**
 * `RELATED;TYPE=` → the role the named person holds relative to the contact.
 * The vocabulary is RFC 6350 §6.6.6; the half of it that describes a kind of
 * acquaintance rather than a kinship has no Leapsake role and comes through as
 * `other` carrying the source word, which is more use than dropping it.
 */
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

/**
 * Whether a `RELATED` value points at another card rather than naming somebody.
 *
 * RFC 6350 lets the value be a URI (`urn:uuid:…`, `mailto:…`) or, with
 * `VALUE=text`, a plain name. Only names can be imported: a URI refers to a card
 * whose own import we would have to resolve against, which needs `UID`
 * bookkeeping and a second pass — see the TODO on {@link relatedFrom}.
 */
function isReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value.trim());
}

/**
 * Map one `RELATED` to a named relation, or `null` when it names nobody.
 *
 * TODO: resolve intra-file references. A `RELATED` holding `urn:uuid:…` points at
 * another card in the same file, and both are usually being imported together —
 * so the pair could become a real relationship between two *published* people
 * instead of each card growing an unpublished stub. Doing it needs `UID` out of
 * `STRUCTURAL` (it is ignored today), a UID→id map built as the batch is written,
 * and a second ingest pass once every card exists. Until then a reference stays
 * in `dropped`, where the review UI already shows it as not imported.
 */
function relatedFrom(p: Property): ParsedRelated | null {
  const value = unescapeValue(p.value).trim();
  if (value === "" || isReference(value)) return null;
  const types = typesOf(p).map((t) => t.toLowerCase());
  const known = types.find((t) => t in RELATED_ROLES);
  if (known !== undefined) {
    return {
      name: value,
      role: RELATED_ROLES[known],
      roleNote: null,
      otherUid: null,
      relationshipId: null,
    };
  }
  // An unmapped TYPE becomes the note on an `other` role, so "TYPE=muse" reads
  // as "muse" on the row rather than vanishing. A RELATED with no TYPE at all
  // says only that they are related, which is what the note then says.
  const note = types.find((t) => !TYPE_NOISE.has(t.toUpperCase())) ?? "related";
  return {
    name: value,
    role: "other",
    roleNote: note,
    otherUid: null,
    relationshipId: null,
  };
}

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

/**
 * Properties **our own writer emits that our own parser cannot read yet** —
 * ignored silently rather than surfaced as dropped.
 *
 * Deliberately not folded into {@link STRUCTURAL}, which is for metadata that is
 * not user data at all. These *are* user data: they say who the user is and when
 * they first recorded somebody. Keeping the two sets apart is what makes the
 * gap visible, and this set is meant to **empty out** when `plans/export.md`
 * increment 5 lands and the parser learns to read them.
 *
 * Everything else the writer emits rides an existing property as a parameter
 * (`X-LEAPSAKE-ROLE` and `-REL-ID` on `RELATED`, `-MILESTONE-*` on `X-ABDATE`),
 * and parameters are invisible to this switch — which is exactly why they are
 * parameters. These two have no property to ride.
 */
const DEFERRED = new Set(["X-LEAPSAKE-SELF", "X-LEAPSAKE-CREATED"]);

/** A parsed physical property line: `[group.]NAME;PARAM=v;PARAM=v:VALUE`. */
interface Property {
  name: string; // upper-cased, group prefix stripped
  group: string | null; // lower-cased `item1.` prefix, or null when ungrouped
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
  // A group prefix is stripped from the name but kept: it is what ties Apple's
  // `item2.X-ABDATE` to the `item2.X-ABLabel` that says what the date is.
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
  const socials: ParsedSocial[] = [];
  const related: ParsedRelated[] = [];
  const dates: ParsedDate[] = [];
  const dropped: DroppedField[] = [];
  let nParts: string[] | null = null;
  let fn: string | null = null;
  let gender: Gender | null = null;
  let birthday: ParsedBirthday | null = null;
  // A birthday spelled as a labelled date rather than as `BDAY`. Held apart and
  // resolved after the loop so the dedicated property wins wherever it appears in
  // the card, exactly as the device importer lets iOS's dedicated birthday field
  // beat a birthday-labelled entry in its `dates` list.
  let labelledBirthday: ParsedBirthday | null = null;

  // Apple hangs what a date means, and what country an address is in, off sibling
  // properties in the same group. Both are collected before the pass that needs
  // them, since the lines may arrive in either order.
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
    // The user's own word for this property, when Apple's grouped `X-ABLABEL`
    // gives one. It names a contact method as readily as it names a date, and
    // for a custom label it is the *only* thing that does.
    const groupLabel = p.group === null ? "" : (groupLabels.get(p.group) ?? "");

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
        // A value naming no service at all stays visible in the review UI's
        // "not imported" list rather than becoming a row pointing nowhere.
        if (social) socials.push(social);
        else dropField(dropped, p.name, p.value);
        break;
      }
      case "URL": {
        // A `URL` is only a social profile when its host says so — a personal
        // homepage or a company site is not one, and guessing would turn every
        // card's website into a fake Instagram row. Anything unrecognised keeps
        // its old behaviour and is surfaced as dropped.
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
      // RFC 6350 §6.2.6. The property names the occasion but not the couple, so
      // it lands on the `anniversary` kind rather than `wedding` — the card does
      // not say which anniversary this is, and inventing one would be the same
      // guess `RELATED` refuses to make about an unmapped role.
      case "ANNIVERSARY": {
        const parsed = parseDateValue(p);
        if (parsed) {
          dates.push({
            kind: "anniversary",
            label: "Anniversary",
            date: parsed,
            note: null,
            id: null,
            relationshipId: null,
          });
        } else dropField(dropped, "ANNIVERSARY", p.value);
        break;
      }
      // How Apple actually writes a dated occasion: `item2.X-ABDATE` carries the
      // value and `item2.X-ABLabel` carries the label, which is the only thing
      // saying what the date *is*. Contacts exports an anniversary this way and
      // never as RFC 6350's `ANNIVERSARY`, so a card straight out of the iPhone
      // used to lose every date it had.
      //
      // Same three outcomes as the device importer, routed through the same
      // {@link dateKindFor} map: a birthday-labelled entry fills the birthday only
      // if `BDAY` didn't, a label with a kind becomes that milestone, and anything
      // else is dropped *by name* — "Date (Graduation)" — rather than guessed into
      // `other`.
      case "X-ABDATE": {
        const parsed = parseDateValue(p);
        const text = p.group === null ? "" : (groupLabels.get(p.group) ?? "");
        if (parsed === null || text === "") {
          dropField(dropped, "X-ABDATE", p.value);
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
        const relation = relatedFrom(p);
        // A reference to another card is not a name we can import, so it stays
        // visible in the review UI's "not imported" list rather than silently
        // going nowhere.
        if (relation) related.push(relation);
        else dropField(dropped, "RELATED", p.value);
        break;
      }
      default:
        if (
          !STRUCTURAL.has(p.name) &&
          !HANDLED.has(p.name) &&
          !DEFERRED.has(p.name)
        ) {
          dropField(dropped, p.name, p.value);
        }
    }
  }

  return {
    // `UID` and `CATEGORIES` are both still ignored on the way in — the first is
    // in `STRUCTURAL`, the second falls to `dropped` — so every parsed card
    // reports the absent value. The *writer* fills both, which is why they are
    // on `ParsedContact` at all; reading them back is `plans/export.md`
    // increment 5, and until it lands re-importing our own file duplicates
    // everyone rather than recognising them.
    uid: null,
    // The same story for the four below: written by us, ignored on the way in.
    // `KIND` and `REV` are in `STRUCTURAL`, `X-LEAPSAKE-SELF` and `-CREATED` in
    // `DEFERRED` — so a pet card of ours re-imports as an ordinary person, which
    // `plans/export.md` accepts until increment 5.
    kind: "individual",
    isSelf: false,
    createdAt: null,
    updatedAt: null,
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
    tags: [],
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
    // A single token that *is* the family name says the card is a surname-only
    // person ("Smith", filed under `N:Smith;;;;`) — not a mononym who also has a
    // surname. Putting it in both slots would duplicate it, which is what the
    // export round-trip caught: we write exactly this card for a person whose
    // only stored name part is a last name.
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

  const country = countryCode(countryRaw, isoHint);
  // A free-text name we could not turn into a code is reported rather than lost;
  // once the code is known the name adds nothing, so it is not.
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

/**
 * An address's country as the ISO 3166-1 alpha-2 code the schema stores, or
 * `null` when the card gives nothing that can be turned into one.
 *
 * `ADR`'s own country component is a free-text *name*, and which name depends on
 * who exported the card and in what locale ("United States", "USA", "États-Unis")
 * — so it is kept only when it already is a code. Apple, however, writes the code
 * itself into an `X-ABADR` alongside the address (`item1.ADR` ⇄ `item1.X-ABADR`),
 * which is read as the fallback: be liberal in what we accept. Mapping a name to
 * a code ourselves is the one thing not done here — that needs a locale-aware
 * country table, and guessing wrong files somebody's address in the wrong country.
 *
 * The device importer has no equivalent: `expo-contacts`' newer `Contact` API
 * carries only the free-text name, so an address read off the phone keeps landing
 * without a country. Accepting less there is not a reason to accept less here.
 */
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

/**
 * Parse a date-valued property (`BDAY`, `ANNIVERSARY`, `X-ABDATE`) into a partial
 * civil date, honouring Apple's way of saying "no year".
 *
 * vCard has a spelling for a year-less date (`--MM-DD`) but the Contacts app does
 * not use it: it writes a placeholder year into the value and names that year in
 * an `X-APPLE-OMIT-YEAR` parameter — `BDAY;X-APPLE-OMIT-YEAR=1604:1604-07-06`.
 * Read the parameter back out and the year is a year again only when it is one
 * somebody meant. Without this, every birthday saved without a year imports as a
 * person born in 1604: silently wrong, which is worse than the device importer's
 * failure mode of merely losing the year.
 *
 * A parameter naming a *different* year than the value carries is not Apple's
 * placeholder convention, so the year stays.
 */
function parseDateValue(p: Property): ParsedPartialDate | null {
  const parsed = parsePartialDate(unescapeValue(p.value).trim());
  if (parsed === null || parsed.year === null) return parsed;
  const omitted = p.params.get("X-APPLE-OMIT-YEAR")?.[0];
  if (omitted === undefined) return parsed;
  return Number.parseInt(omitted, 10) === parsed.year
    ? { ...parsed, year: null }
    : parsed;
}

/**
 * Parse a vCard date value (`BDAY`, `ANNIVERSARY`) into a partial civil date.
 * Handles v4 basic `19920309`, extended `1992-03-09`, year-less `--0309` /
 * `--03-09`, year-only `1992`, and any leading date of a date-time (`…T…`).
 * Upholds day⇒month (a lone day is dropped). Returns `null` when nothing usable
 * is present.
 */
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

/**
 * Map a source's word for a network onto a `@leapsake/contact-links` platform id.
 *
 * vCard names a service in three different ways depending on the property and
 * the exporter: `IMPP` puts it in the URI scheme (`xmpp:`, `skype:`), and both
 * `IMPP` and `X-SOCIALPROFILE` may repeat it in `TYPE=` or `X-SERVICE-TYPE=`.
 * All of them are matched case-insensitively against the registry's ids and
 * names, so "Twitter" reaches `x` via the alias table below.
 *
 * An unmatched word is returned lowercased and stored as-is rather than dropped:
 * an account on a network Leapsake has never heard of is still a real way to
 * reach somebody, and `socialProfileSchema` accepts any platform string for
 * exactly this reason.
 */
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

/**
 * Read an `IMPP` or `X-SOCIALPROFILE` into a {@link ParsedSocial}, or `null` when
 * the card names no service and gives no usable value.
 *
 * The value may be a bare handle, a `service:handle` URI, or a full profile URL.
 * A URL is kept in `url` as well as reduced to a handle, since that is what makes
 * an unrecognised platform openable at all.
 */
function socialFrom(p: Property, groupLabel = ""): ParsedSocial | null {
  const value = unescapeValue(p.value).trim();
  if (value === "") return null;

  const serviceParam =
    p.params.get("X-SERVICE-TYPE")?.[0] ??
    typesOf(p).find((t) => !TYPE_NOISE.has(t) && t !== "HOME" && t !== "WORK");

  // `IMPP` values are URIs; the scheme names the service when no parameter does.
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
    // No source card spells a platform's opaque account id in a form worth
    // guessing at, so it arrives absent and is filled only by hand. The writer
    // still emits ours — see {@link ParsedSocial.platformUserId}.
    platformUserId: null,
  };
}

/** The registrable word of a URL's host — `www.instagram.com` → `instagram`. */
function hostWord(url: string): string {
  const host = /^[a-z]+:\/\/([^/?#]+)/i.exec(url)?.[1] ?? "";
  const parts = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  return parts[0] ?? "";
}

/**
 * Turn a property's `TYPE`s into a display label: the sibling `X-ABLABEL` wins
 * outright; then the first recognised type; then the first non-noise type,
 * title-cased; otherwise "Other". Guarantees a non-empty label (contact-method
 * labels are `min(1)`).
 *
 * **`groupLabel` is what iOS Contacts itself shows.** Apple puts a standard
 * label in `TYPE` and a user's own words in a grouped `X-ABLABEL`
 * (`item1.TEL` + `item1.X-ABLABEL:Beach house`), so a card straight out of an
 * iPhone carries every custom label that way and only that way — and until this
 * argument existed, every one of them arrived here as "Other". It is already
 * unwrapped through `appleLabelText` by the caller, so an Apple constant
 * (`_$!<Home>!$_`) reads as "Home" rather than beating the `TYPE` with a
 * sentinel.
 */
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
