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

/**
 * The vCard **writer** — `vcard.ts` inverted, property for property.
 *
 * Every primitive here undoes exactly one of the parser's, and they live in one
 * package for that reason: `foldLine` against `unfold`, `escapeValue` against
 * `unescapeValue`, `joinStructured` against `splitStructured`, `writeParam`
 * against `splitUnquoted` + `unquote`, `formatPartialDate` against
 * `parsePartialDate`, the `*_TYPE_FOR_LABEL` tables against `labelFrom`,
 * {@link RELATED_TYPE_FOR_ROLE} against `RELATED_ROLES`. The test that matters
 * is `parseVCards(writeVCards(x)) ≡ x`, and it only exists because both halves
 * are here.
 *
 * **This writes the whole person graph** (`plans/export.md` increments 1 and 2):
 * people and pets, their contact methods, all ten milestone kinds, and the
 * relationships between them.
 *
 * The facts vCard has no vocabulary for ride **parameters on the property they
 * qualify** rather than becoming properties of their own: `X-LEAPSAKE-ROLE` and
 * `-REL-ID` on a `RELATED`, `X-LEAPSAKE-MILESTONE-*` on an `X-ABDATE`,
 * `X-LEAPSAKE-EXT`/`-COUNTRY` on a `TEL`. That is not only tidiness — an unknown
 * *parameter* is invisible to any parser, while an unknown *property* lands in
 * our own reader's `dropped` list, which would fill a user's re-import review
 * with noise about their own file. `X-LEAPSAKE-SELF` and `X-LEAPSAKE-CREATED`
 * are the two facts with nothing to ride; the parser's `DEFERRED` set is what
 * keeps them quiet until increment 5 reads them.
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
  // Groups are allocated by a counter rather than derived from the lines already
  // pushed, because a caller now takes a group *before* pushing either of the two
  // lines that will share it (an `X-ABDATE` and its `X-ABLABEL`). Deriving it
  // would hand the second caller the same `itemN` and silently merge two facts.
  let groups = 0;
  const nextGroup = (): string => `item${++groups}`;

  push({ name: "BEGIN", value: "VCARD" });
  push({ name: "VERSION", value: VERSION });
  push({ name: "PRODID", value: opts.prodId });
  if (contact.uid !== null) {
    push({ name: "UID", value: `urn:uuid:${contact.uid}` });
  }
  // RFC 6350 §6.1.4, which explicitly allows an x-name. Apple Contacts will
  // import a pet card as an ordinary person called "Rex" — accepted in
  // `plans/export.md`: nothing is lost, and our own importer gets it right once
  // increment 5 takes `KIND` out of the parser's `STRUCTURAL` set.
  push({
    name: "KIND",
    value: contact.kind === "pet" ? "x-pet" : "individual",
  });

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

  /** The `itemN.X-ABLABEL` naming a custom-labelled property, when there is one. */
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
    // One group carries all three of an address's lines: the `ADR`, the
    // `X-ABLABEL` naming it when the label is the user's own, and the `X-ABADR`
    // holding its ISO country (Apple's convention, and what `countryCode` reads
    // as its hint). Allocating two would separate an address from its own
    // country, which is the bug this shape exists to prevent.
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
  // Every other dated milestone, birthday included where one somehow arrives
  // here rather than in `birthday`. `ANNIVERSARY` is never written — measured
  // dead on iOS (`plans/export.md` → *Writing dates*), which is why even an
  // anniversary goes out this way.
  for (const date of contact.dates) {
    const value = formatPartialDate(date.date);
    if (value === null) continue;
    const group = nextGroup();
    push({ group, name: "X-ABDATE", params: milestoneParams(date), value });
    push({ group, name: "X-ABLABEL", value: date.label });
  }

  for (const relation of contact.related) push(relatedLine(relation));

  // Record metadata last, where Apple puts `REV` — facts about the row rather
  // than about the person.
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
 * table is not a `TYPE` at all — see {@link labelSpelling}.
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

/** How one contact method's label is spelled on the wire. */
interface LabelSpelling {
  /** The `TYPE` param carrying it, when the standard vocabulary has one. */
  params: Param[] | undefined;
  /** The label to write as a sibling `itemN.X-ABLABEL`, when it does not. */
  ablabel: string | null;
}

/**
 * How to spell a label — three outcomes, and only the third is new.
 *
 * "Other" is written as *nothing*: `labelFrom` returns it when a property has no
 * usable type, so an absent `TYPE` already round-trips to "Other" — and `OTHER`
 * is in the parser's own `TYPE_NOISE`, so writing it would be a line that says
 * nothing and reads back the same.
 *
 * A label in the table becomes that standard `TYPE`.
 *
 * **Anything else is the user's own words, and goes out as Apple's
 * `itemN.<PROP>` + `itemN.X-ABLABEL` pair.** Increment 1 wrote it as the `TYPE`
 * value instead (`TYPE=Mum's place`), which round-trips through `labelFrom`'s
 * title-case fallback but is not what iOS Contacts reads — so the one platform
 * v0.1 ships to showed a custom-labelled phone as untyped. The `X-ABLABEL` form
 * is what Contacts writes itself, our parser's group pre-pass already reads it
 * through `appleLabelText`, and it round-trips **exactly** rather than
 * title-cased. Increment 1's test asserting the old spelling is meant to change
 * here.
 */
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
  return { group, name: "TEL", params, value: phone.number };
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

/**
 * A social profile as `X-SOCIALPROFILE` — Apple's property, and the one the
 * parser reads a `X-SERVICE-TYPE` off. The value is the profile URL when we have
 * one (that is what makes an unrecognised platform openable at all) and the bare
 * handle otherwise.
 */
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

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * The four facts an `X-ABDATE` has nowhere to put, as parameters riding the date
 * they belong to.
 *
 * `X-LEAPSAKE-MILESTONE-KIND` is the load-bearing one. Apple's convention leaves
 * the sibling `X-ABLABEL` as the only thing saying what a date *is*, and the
 * parser's `dateKindFor` reads it — but a milestone of kind `other` wants its
 * *note* as its label ("Beach house closing"), which no map could ever resolve
 * back to a kind. Carrying the kind outright means the label stays the thing a
 * human reads in Contacts while the kind stays exact for us.
 *
 * `-REL` marks a milestone the *relationship* bears rather than either partner —
 * a wedding belongs to the marriage. Such a milestone is written on **both**
 * partners' cards with the same `-ID`, which is the same shape `RELATED` uses:
 * one fact, two cards, an id that identifies the halves.
 */
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
  // Skipped when the note already *is* the label, which is what it means on an
  // `other`-kind milestone — writing it twice would say nothing new and would
  // make the two spellings able to disagree.
  if (date.note !== null && date.note !== date.label) {
    params.push({ key: "X-LEAPSAKE-MILESTONE-NOTE", value: date.note });
  }
  return params;
}

// ---------------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------------

/**
 * A Leapsake role → the `RELATED;TYPE=` token that reads back as it, inverting
 * the parser's `RELATED_ROLES`. Keyed by the role's **base**, since that is what
 * a gendered variant reduces to.
 *
 * `coworker` writes RFC 6350's own `co-worker`; the parser accepts both that and
 * `colleague`.
 */
const RELATED_TYPE_FOR_ROLE: Record<string, string> = {
  spouse: "spouse",
  child: "child",
  parent: "parent",
  sibling: "sibling",
  friend: "friend",
  neighbor: "neighbor",
  coworker: "co-worker",
};

/**
 * The `TYPE` token for a role, or `null` when there is nothing to say.
 *
 * Leapsake has 41 roles and RFC 6350 has seven words we can map, so the standard
 * token names the role's **base** — `mother` goes out as `TYPE=parent` — and the
 * exact role rides alongside in `X-LEAPSAKE-ROLE`. Writing `TYPE=mother` instead
 * would tell a standards consumer nothing (it reads as an unknown type) *and*
 * lose the kinship on the way back through us, since `RELATED_ROLES` has no
 * entry for it. A base with no RFC word at all (`cousin`, `classmate`,
 * `grandparent`, `pibling`, `owner`…) is written as itself, an x-name `TYPE` in
 * all but spelling.
 *
 * Role `other` is the exception: its `TYPE` is the user's own note, **bare**.
 * `relatedFrom` turns an unmapped type into exactly that note, so `TYPE=muse`
 * round-trips to "muse" while the `x-muse` an x-name convention would suggest
 * round-trips to the literal string "x-muse".
 */
function relatedType(relation: ParsedRelated): string | null {
  if (relation.role === "other") return relation.roleNote;
  const base: RelationshipRole = roleDefs[relation.role].base;
  return RELATED_TYPE_FOR_ROLE[base] ?? base;
}

/**
 * One edge as `RELATED`.
 *
 * Two forms, decided by whether the other end has a card of its own. An
 * unpublished person exists only as a fact about this one, so they are *named*
 * (`VALUE=text`); a published person has their own card, so they are *pointed
 * at* (`VALUE=uri:urn:uuid:…`). The edge is written on both cards either way —
 * that is what vCard means by `RELATED`, and `X-LEAPSAKE-REL-ID` is what lets an
 * importer recognise the two halves as one relationship rather than two.
 *
 * `VALUE` is spelled out on both, although `uri` is the property's default: the
 * parser tells them apart by looking for a scheme, so the parameter buys nothing
 * mechanically — it buys a reader (and a strict consumer) being told outright.
 */
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
 *
 * **Newlines are folded to a space** for the same reason, one step worse: RFC
 * 6350's param grammar is `QSAFE-CHAR`, which excludes control characters
 * outright, and a raw newline here would end the *line*, turning the rest of the
 * property into a continuation of nothing. This is not hypothetical any more —
 * a milestone's note is multi-line free text and rides
 * `X-LEAPSAKE-MILESTONE-NOTE`. The note stops being byte-exact; the alternative
 * is a corrupt card or dropping the note entirely.
 */
function writeParam(value: string): string {
  const clean = value.replace(/"/g, "").replace(/[\r\n]+/g, " ");
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
