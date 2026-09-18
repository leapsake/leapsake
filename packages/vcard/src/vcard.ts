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
  // The card's own identity, and the tags it carries. `UID`, `KIND` and `REV`
  // sat in `STRUCTURAL` until they were read; they are listed here now because
  // they map to real fields, and leaving them in a set named "neither mapped nor
  // user-visible" is how the next reader concludes they are still ignored.
  "UID",
  "KIND",
  "REV",
  "CATEGORIES",
  "X-LEAPSAKE-SELF",
  "X-LEAPSAKE-CREATED",
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
 * `VALUE=text`, a plain name. A `urn:uuid:` naming a card **in this same file**
 * resolves against it; every other URI (a `mailto:`, or a uuid whose card is not
 * here) names somebody this file cannot describe, and stays in `dropped`.
 */
function isReference(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value.trim());
}

/**
 * Map one `RELATED` to a relation, or `null` when it names nobody we can reach.
 *
 * Two forms, and the difference is whether the other end has a card of its own.
 * An unpublished person is *named* (`VALUE=text`), because a name attached to
 * this contact is all the store holds of them. A published one is *pointed at*
 * (`VALUE=uri:urn:uuid:…`) — and since a pointer carries no name, theirs is read
 * from the card it points at, which `parseVCards` indexed before building any
 * contact. That index is why this takes `namesByUid`: the edge and the card it
 * references may arrive in either order, and usually do.
 *
 * The **ingest** side still has work the parser cannot do for it: this says
 * "these two cards are related", and the engine is what turns one such fact,
 * written on both cards, into a single relationship — see `ingest.ts`.
 */
function relatedFrom(
  p: Property,
  namesByUid: Map<string, string>,
): ParsedRelated | null {
  const value = unescapeValue(p.value).trim();
  if (value === "") return null;

  // Whose card this points at, and what to call them. A reference carries no
  // name of its own, so the name has to come from the card it names — and a
  // reference to a card **not in this file** is one we cannot import at all, so
  // it stays in `dropped`, exactly where it was before any of this was read.
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

  // Our own card carries the **exact** role beside the standard one, because
  // Leapsake has 41 roles and RFC 6350 gives seven words. Preferring it is what
  // stops `mother` coming back as `parent` and `cousin` as `other` — the
  // degradation that was unavoidable while only `TYPE` was read.
  if (exact !== null && exact in roleDefs) {
    const role = exact as RelationshipRole;
    return {
      name,
      // A note qualifies an `other` role and nothing else, which is the rule
      // `createRelationshipInputSchema` enforces on the way in too. For that
      // role the writer puts the note in `TYPE` **bare**, so it is read from the
      // raw parameter rather than `typesOf`, whose upper-casing would otherwise
      // return "Muse" as "muse".
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
  // An unmapped TYPE becomes the note on an `other` role, so "TYPE=muse" reads
  // as "muse" on the row rather than vanishing. A RELATED with no TYPE at all
  // says only that they are related, which is what the note then says.
  const note = types.find((t) => !TYPE_NOISE.has(t.toUpperCase())) ?? "related";
  return { name, role: "other", roleNote: note, otherUid, relationshipId };
}

/**
 * The first `TYPE` that is not parameter noise, **as the card spelled it** —
 * the note on an `other` role, which is a user's own word ("Muse", "Beach
 * house") and so must keep its casing. `null` when the card gave none, which is
 * what the writer emits for an `other` role whose note is itself absent.
 */
function rawNote(p: Property): string | null {
  const raw = (p.params.get("TYPE") ?? []).find(
    (t) => !TYPE_NOISE.has(t.trim().toUpperCase()),
  );
  return raw === undefined ? null : nullIfEmpty(raw.trim());
}

/** Structural / metadata properties that are neither mapped nor user-visible
 *  data — silently ignored (not surfaced as "dropped"). */
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

  // Two passes, because a `RELATED` may point at another card in the same file
  // by `UID` instead of naming anybody — and the name it does not carry is that
  // card's own `FN`. Indexing every card's UID→`FN` first is what lets the build
  // below resolve one without the property order, or the card order, mattering.
  const namesByUid = new Map<string, string>();
  for (const props of cards) {
    const uid = uidOf(props);
    const fn = displayNameOf(props);
    if (uid !== null && fn !== null) namesByUid.set(uid, fn);
  }
  return cards.map((props) => buildContact(props, namesByUid));
}

/** A card's `UID` with the `urn:uuid:` prefix off, for the index above. Kept
 *  beside {@link displayNameOf} so the pre-pass reads the two the same way the
 *  main pass does. */
function uidOf(props: Property[]): string | null {
  const p = props.find((prop) => prop.name === "UID");
  return p === undefined ? null : parseUid(p.value);
}

function displayNameOf(props: Property[]): string | null {
  const p = props.find((prop) => prop.name === "FN");
  return p === undefined ? null : nullIfEmpty(unescapeValue(p.value).trim());
}

/** `UID:urn:uuid:<id>` → `<id>`; any other spelling kept as it came. */
function parseUid(raw: string): string | null {
  const value = unescapeValue(raw).trim();
  return nullIfEmpty(value.replace(/^urn:uuid:/i, "").trim());
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

/**
 * Split a structured value into components on an **unescaped** delimiter — `;`
 * for the structured properties (N, ADR), `,` for the list ones (CATEGORIES).
 *
 * The delimiter is a parameter rather than there being a second copy of this
 * loop, because the thing that is easy to get wrong is the same in both cases:
 * a delimiter *inside* a component is escaped, and a splitter that does not know
 * that turns one tag holding a comma into two tags.
 */
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
      // The entity's stable id. Our own writer spells it `urn:uuid:<people.id>`
      // (RFC 6350 §6.7.6 prefers a URN), so the scheme comes off — but a `UID`
      // in any other form is still this card's id to whoever wrote it, and is
      // kept verbatim rather than refused. What it is *used* for is matching,
      // never as the id of the row we create: see `plans/v0-2.md` → *Export*.
      case "UID":
        uid = parseUid(p.value);
        break;
      // RFC 6350 §6.1.4, which allows an x-name — so a pet is `KIND:x-pet`.
      // Anything else (`individual`, `org`, `group`, or a kind we have never
      // heard of) is read as an individual: Leapsake has two shapes, and a card
      // that says `group` is far closer to a person than to a pet.
      case "KIND":
        kind =
          unescapeValue(p.value).trim().toLowerCase() === "x-pet"
            ? "pet"
            : "individual";
        break;
      // A list value, not a structured one: each tag is escaped on its own and
      // joined on a *raw* comma, which is what makes a tag containing a comma
      // survive as one tag rather than becoming two.
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
            // Both ride as parameters on the `TEL` they qualify, because a
            // standard `TEL` has nowhere to put either: RFC 6350 folds an
            // extension into the number and carries no ISO country at all.
            // Absent from a foreign card, which is what `null` then means.
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
      // saying what the date *is* — unless the card is **ours**, in which case
      // `X-LEAPSAKE-MILESTONE-KIND` says it outright. Contacts exports an
      // anniversary this way and never as RFC 6350's `ANNIVERSARY`, so a card
      // straight out of the iPhone used to lose every date it had.
      //
      // Two paths, and which one runs is decided by that parameter:
      //
      //  - **Our own card** — the kind is read, and every one of the ten survives
      //    along with its note, its id and the relationship that bears it.
      //  - **Anybody else's** — the same three outcomes as the device importer,
      //    routed through the same {@link dateKindFor} map: a birthday-labelled
      //    entry fills the birthday only if `BDAY` didn't, a label naming one of
      //    the eight recoverable kinds becomes that milestone, and anything else
      //    is dropped *by name* — "Date (Beach house closing)" — rather than
      //    guessed into `other`.
      case "X-ABDATE": {
        const parsed = parseDateValue(p);
        const exact = milestoneKindParam(p);
        // The label is what a human reads in Contacts, and normally the only
        // thing naming the date. A card that carries the kind outright but no
        // `X-ABLABEL` is still fully described, so the kind's own label stands
        // in rather than the whole date being dropped — `ParsedDate.label` is
        // `min(1)` at the boundary and must never be empty.
        const group = p.group === null ? "" : (groupLabels.get(p.group) ?? "");
        const text =
          group !== "" || exact === null ? group : kindDefs[exact].label;
        if (parsed === null || text === "") {
          dropField(dropped, "X-ABDATE", p.value);
          break;
        }
        // ⚠️ The parameter wins **here**, ahead of the birthday short-circuit
        // below. A store holding two birthday-kind milestones exports the first
        // as `BDAY` and the second as a "Birthday"-labelled `X-ABDATE`; without
        // this ordering the second is swallowed by `labelledBirthday` and lost.
        // The branch after it is the foreign-card rule and must stay as it was:
        // an iPhone card that spells its birthday twice still collapses to one.
        if (exact !== null) {
          dates.push({
            kind: exact,
            label: text,
            date: parsed,
            // The writer omits `-NOTE` when the note already *is* the label,
            // which is what it means on an `other`-kind milestone — so that kind
            // recovers its note from the label alone, and no other kind invents
            // one it never had.
            //
            // Except when the label is the kind's own generic word, which is
            // what a **note-less** `other` is written as: reading "Other" back as
            // a note would invent free text the user never typed. The cost is
            // that somebody whose note is literally "Other" loses it — a note
            // that displays identically either way (`milestoneLabel`).
            note: noteFor(p, exact, text),
            // Both are the **file's** ids, and neither is written back as a row
            // id: `-ID` is what says "one fact on two cards" to `ingestContacts`,
            // and `-REL` names an edge that only exists once the import has
            // created it. Restoring ids verbatim is `plans/v0-2.md` → *Export*.
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
        // A reference to another card is not a name we can import, so it stays
        // visible in the review UI's "not imported" list rather than silently
        // going nowhere.
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
    // The card's own identity. `uid` is what lets the review recognise a card as somebody
    // already stored instead of importing a second copy of them, and it is the
    // hinge the graph and milestone reciprocals hang off — a `RELATED` pointing
    // at `urn:uuid:…` can only resolve because the card it points at reports
    // one. **It is a matching key, never the id of the row an import creates**;
    // writing the file's ids back verbatim is a restore, which is increment 6.
    uid,
    kind,
    isSelf,
    // Read for the round trip's sake and for increment 6, but **inert today**:
    // no `create` input accepts a `createdAt`, so an imported entity is stamped
    // with the moment it was imported. Honouring this is the restore door.
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
    // person ("Martini", filed under `N:Martini;;;;`) — not a mononym who also has a
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

/**
 * A vCard timestamp as epoch ms — the inverse of the writer's `formatTimestamp`,
 * which emits `2026-09-07T01:35:00Z`.
 *
 * Deliberately delegated to `Date.parse` rather than hand-rolled, unlike
 * {@link parsePartialDate} above: a *civil* date has no timezone and must not be
 * shifted by one, which is why that one is parsed by hand — but `REV` and
 * `X-LEAPSAKE-CREATED` are instants, where the offset is the point. Anything
 * unparseable (or a card that writes `REV` in some other dialect) yields `null`
 * rather than throwing, so one bad line never costs the whole card.
 */
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

// ---------------------------------------------------------------------------
// TYPE → label mapping
// ---------------------------------------------------------------------------

/** All `TYPE=` values on a property, upper-cased (bare 2.1 types included). */
function typesOf(p: Property): string[] {
  return (p.params.get("TYPE") ?? []).map((t) => t.toUpperCase());
}

/**
 * A single-valued parameter's text, or `null` when the property does not carry
 * it — how every `X-LEAPSAKE-*` fact is read back.
 *
 * The writer puts these facts in *parameters* rather than properties precisely
 * because an unknown parameter is invisible to any parser, while an unknown
 * property would land in this reader's own `dropped` list and fill a user's
 * re-import review with noise about their own file. Reading one is therefore
 * always a lookup here, never a `case` in the property switch.
 */
function paramValue(p: Property, key: string): string | null {
  const value = p.params.get(key)?.[0];
  return value === undefined ? null : nullIfEmpty(value.trim());
}

/**
 * A milestone's free text: the parameter that carries it, or — for the one kind
 * whose note *is* its label — the label the writer left it as.
 */
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

/**
 * The milestone kind a date carries **outright**, or `null` for a card that
 * carries none — which is every card but ours.
 *
 * This is the reason `DATE_KINDS` never has to be exact. Apple's convention leaves the
 * sibling `X-ABLABEL` as the only thing saying what a date *is*, and a label is
 * a guess: kind `other` wears the user's own note ("Beach house closing") as its
 * label, which no map could ever resolve back. Carrying the kind in a parameter
 * means the label stays the thing a human reads in Contacts while the kind stays
 * exact for us — so our own file needs no label guessing at all.
 *
 * An unrecognised value falls back to the label lookup rather than failing: a
 * kind we have never heard of is a card from a *newer* Leapsake, and the label
 * beside it is still worth reading.
 */
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
    // No *foreign* card spells a platform's opaque account id in a form worth
    // guessing at, so it stays absent for one. Our own writer emits it as a
    // parameter, because it is stored, unrecoverable from the handle, and would
    // otherwise be missing from the one file the user is told is their backup.
    platformUserId: paramValue(p, "X-LEAPSAKE-USERID"),
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
