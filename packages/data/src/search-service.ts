import {
  type EntityType,
  type SearchHit,
  type SearchResultType,
  digits,
  fold,
  foldAddress,
  formatMilestoneDate,
  formatPostalAddress,
  normalizeEmail,
  normalizePhone,
  parseBirthdayQuery,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

// `parseBirthdayQuery` now lives in `@leapsake/schema` (shared with the highlight
// package); re-export it so its callers and tests keep their existing import.
export { parseBirthdayQuery };

/**
 * Shortest query we act on. Below this we return nothing, keeping the
 * truly-empty case quiet without per-facet length rules. A named constant so
 * tuning it is a one-line change.
 */
const MIN_QUERY_LENGTH = 2;

/** Upper bound on results returned per query. */
const MAX_RESULTS = 50;

/** Match-quality of a folded candidate field against a folded term. Lower is better. */
const QUALITY_EXACT = 0;
const QUALITY_STARTS_WITH = 1;
const QUALITY_SUBSTRING = 2;
const QUALITY_NONE = 3;

function quality(field: string, term: string): number {
  if (field === term) return QUALITY_EXACT;
  if (field.startsWith(term)) return QUALITY_STARTS_WITH;
  if (field.includes(term)) return QUALITY_SUBSTRING;
  return QUALITY_NONE;
}

/** A `(type, id)` accumulator-map key. The `"tag"` namespace can't collide with
 * a person/pet id, so tag results group separately from the entities they tag. */
const key = (type: SearchResultType, id: string) => `${type}:${id}`;

export interface SearchService {
  /**
   * Find people and pets matching `term`, by name or by an owned phone/email.
   * Loads the active rows and matches them in memory (no SQL `LIKE`, no index),
   * resolves every hit to its owning entity, groups by `(entityType, entityId)`,
   * and returns one `SearchHit` per entity with its match reasons merged.
   * Returns `[]` for queries shorter than {@link MIN_QUERY_LENGTH}.
   */
  query(term: string): Promise<SearchHit[]>;
}

interface PersonRow {
  id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
}
interface PetRow {
  id: string;
  name: string;
}
/** The contact-method columns search matches (`normalized`) and displays (`address`). */
interface EmailMatchRow {
  owner_type: string;
  owner_id: string;
  address: string;
  normalized: string;
}
/** As {@link EmailMatchRow}, displaying the raw `number`. */
interface PhoneMatchRow {
  owner_type: string;
  owner_id: string;
  number: string;
  normalized: string;
}
/** Postal columns: matched as one folded blob, displayed via `formatPostalAddress`. */
interface PostalMatchRow {
  owner_type: string;
  owner_id: string;
  line1: string;
  line2: string | null;
  locality: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}
/** A tagging joined to its tag: matched on `normalized`, displayed as `name`. */
interface TagMatchRow {
  entity_type: string;
  entity_id: string;
  name: string;
  normalized: string;
}
/** A tag itself, surfaced as its own navigable result (matched on `normalized`). */
interface TagRow {
  id: string;
  name: string;
  normalized: string;
}
/** A birthday milestone: matched on its partial date, resolved to its subject. */
interface BirthdayMatchRow {
  subject_type: string;
  subject_id: string;
  year: number | null;
  month: number | null;
  day: number | null;
}

/** An accumulating result row plus the keys we sort on. */
interface Accumulator {
  hit: SearchHit;
  /** True for a name match; contact-only matches (phone/email) sort after these. */
  isName: boolean;
  /** Best (lowest) match-quality bucket across all matched fields. */
  bestQuality: number;
}

/**
 * Global search over people and pets. Read-only cross-table aggregator in the
 * same shape as the other read-time fan-outs (`kinship-service`,
 * `milestone-timeline`): pull the small set of active rows and derive on read.
 */
export function createSearchService(driver: SqliteDriver): SearchService {
  async function query(term: string): Promise<SearchHit[]> {
    if (term.trim().length < MIN_QUERY_LENGTH) return [];
    const folded = fold(term);
    const emailQuery = normalizeEmail(term); // trimmed + lowercased
    const phoneQuery = normalizePhone(term); // leading "+" + digits only
    const addressQuery = foldAddress(term); // comma/whitespace-insensitive
    const tagQuery = folded.replace(/^#+/, ""); // the "#" sigil is optional here

    const [
      people,
      pets,
      emails,
      phones,
      postals,
      taggings,
      tagList,
      birthdays,
    ] = await Promise.all([
      driver.all<PersonRow>(
        "SELECT id, first_name, middle_name, last_name FROM people WHERE deleted_at IS NULL",
      ),
      driver.all<PetRow>("SELECT id, name FROM pets WHERE deleted_at IS NULL"),
      driver.all<EmailMatchRow>(
        "SELECT owner_type, owner_id, address, normalized FROM email_addresses WHERE deleted_at IS NULL",
      ),
      driver.all<PhoneMatchRow>(
        "SELECT owner_type, owner_id, number, normalized FROM phone_numbers WHERE deleted_at IS NULL",
      ),
      driver.all<PostalMatchRow>(
        `SELECT owner_type, owner_id, line1, line2, locality, region, postal_code, country
           FROM postal_addresses WHERE deleted_at IS NULL`,
      ),
      driver.all<TagMatchRow>(
        `SELECT g.entity_type, g.entity_id, t.name, t.normalized
           FROM taggings g JOIN tags t ON t.id = g.tag_id
          WHERE g.deleted_at IS NULL AND t.deleted_at IS NULL`,
      ),
      driver.all<TagRow>(
        "SELECT id, name, normalized FROM tags WHERE deleted_at IS NULL",
      ),
      driver.all<BirthdayMatchRow>(
        `SELECT subject_type, subject_id, year, month, day
             FROM milestones
            WHERE kind = 'birthday' AND deleted_at IS NULL`,
      ),
    ]);

    const acc = new Map<string, Accumulator>();
    /**
     * `(type, id) → display title` for every active entity. A contact hit
     * resolves its owner's title here (the §4 "free title lookup"); an owner not
     * in this map is soft-deleted/unresolvable, so its contact rows drop (§2.4).
     */
    const titleByEntity = new Map<
      string,
      { type: EntityType; title: string }
    >();

    /**
     * Record (or merge) a match against an entity's grouped row, keeping the
     * grouping/merge logic in one place (§2.2). `isName` only ever flips on, and
     * `bestQuality` only ever improves.
     */
    const record = (
      type: SearchResultType,
      id: string,
      title: string,
      isName: boolean,
      facet: string,
      matchedText: string,
      matchQuality: number,
    ) => {
      const k = key(type, id);
      const existing = acc.get(k);
      if (existing) {
        existing.isName ||= isName;
        existing.bestQuality = Math.min(existing.bestQuality, matchQuality);
        existing.hit.reasons.push({ facet, matchedText });
        return;
      }
      acc.set(k, {
        hit: {
          entityType: type,
          entityId: id,
          title,
          reasons: [{ facet, matchedText }],
        },
        isName,
        bestQuality: matchQuality,
      });
    };

    /** Record a name match if any of `fields` matches the folded term. */
    const addNameHit = (
      type: EntityType,
      id: string,
      title: string,
      fields: string[],
    ) => {
      let best = QUALITY_NONE;
      for (const field of fields) {
        best = Math.min(best, quality(fold(field), folded));
      }
      if (best === QUALITY_NONE) return; // no field matched
      record(type, id, title, true, "name", title, best);
    };

    for (const p of people) {
      // The middle name is normally hidden, but surfaced in the title when the
      // term matched *it* specifically — so a hit explained only by the middle
      // name ("br" → "Joseph Abraham Lampe") shows why it's there, while an
      // ordinary first/last hit stays "Joseph Lampe".
      const plain = `${p.first_name} ${p.last_name}`;
      // The owner-resolution title (for contact-only hits) is always the plain
      // form — the middle name is only relevant when the *name* matched it.
      titleByEntity.set(key("person", p.id), { type: "person", title: plain });
      const middle = p.middle_name ?? "";
      const showMiddle = middle !== "" && fold(middle).includes(folded);
      const title = showMiddle
        ? `${p.first_name} ${middle} ${p.last_name}`
        : plain;
      addNameHit("person", p.id, title, [p.first_name, middle, p.last_name]);
    }
    for (const pet of pets) {
      titleByEntity.set(key("pet", pet.id), { type: "pet", title: pet.name });
      addNameHit("pet", pet.id, pet.name, [pet.name]);
    }

    /**
     * Resolve a matched contact method to its owning entity (drop unresolvable
     * owners, §2.4) and merge the human-readable `matchedText` as the reason
     * (§2.1, §2.3). The caller has already decided this row matched and with what
     * quality — keeping per-facet match logic in its own block (§4).
     */
    const addOwnerHit = (
      ownerType: string,
      ownerId: string,
      facet: string,
      matchedText: string,
      matchQuality: number,
    ) => {
      const owner = titleByEntity.get(key(ownerType as EntityType, ownerId));
      if (!owner) return; // soft-deleted / household owner, not searchable in v1
      record(
        owner.type,
        ownerId,
        owner.title,
        false,
        facet,
        matchedText,
        matchQuality,
      );
    };

    // Email: forward substring of the normalized address. Any query of sufficient
    // length can match (typing "jane" lighting up jane@… and merging with the
    // name hit is the intended §2.2 behavior).
    for (const e of emails) {
      if (e.normalized.includes(emailQuery)) {
        addOwnerHit(
          e.owner_type,
          e.owner_id,
          "email",
          e.address,
          quality(e.normalized, emailQuery),
        );
      }
    }
    // Phone: compare on digits only — this both ignores formatting and, crucially,
    // matches *either direction*, so a stored number and a typed number whose only
    // difference is a country code / leading "+" still match (e.g. stored
    // "5551234567" vs typed "+1 555 123 4567"). Run only when the query carries
    // digits, so a pure-letter query doesn't match every number. Robust
    // cross-format matching (trunk-prefix locales) is still libphonenumber
    // territory (§8).
    const phoneDigits = digits(phoneQuery);
    if (phoneDigits.length > 0) {
      for (const ph of phones) {
        const stored = digits(ph.normalized);
        if (stored.length === 0) continue; // a digitless number matches nothing
        if (!(stored.includes(phoneDigits) || phoneDigits.includes(stored))) {
          continue;
        }
        // Quality is only meaningful in the forward direction; a reverse-only
        // match (typed longer than stored) falls back to the substring bucket.
        const q = quality(stored, phoneDigits);
        addOwnerHit(
          ph.owner_type,
          ph.owner_id,
          "phone",
          ph.number,
          q === QUALITY_NONE ? QUALITY_SUBSTRING : q,
        );
      }
    }
    // Postal: no normalized column, so fold the formatted one-line address and
    // substring it (concatenate-all field scope, §10.4). The address fold ignores
    // commas/spacing, so "123 any street pittsburgh" matches "123 Any Street,
    // Pittsburgh". The guard keeps a comma/space-only query from matching every
    // address (it folds to ""). Type a street number or a city and the owning
    // entity surfaces; the reason shows the full address.
    if (addressQuery !== "") {
      for (const pa of postals) {
        const display = formatPostalAddress({
          line1: pa.line1,
          line2: pa.line2,
          locality: pa.locality,
          region: pa.region,
          postalCode: pa.postal_code,
          country: pa.country,
        });
        const haystack = foldAddress(display);
        if (haystack.includes(addressQuery)) {
          addOwnerHit(
            pa.owner_type,
            pa.owner_id,
            "address",
            display,
            quality(haystack, addressQuery),
          );
        }
      }
    }
    // Tag-as-result: a tag has its own screen, so a matching tag surfaces as its
    // own navigable row. It's recorded as a name hit on the tag itself (facet
    // "name", so no "matched on …" line), and the sort floats it above the
    // entities that merely carry the tag (see the tag tiebreak below). This is
    // the one facet that surfaces as itself rather than only resolving to owners.
    // tagList holds only active tags (orphans are GC-soft-deleted), so a match
    // here always has at least one bearer below it. Matched on tagQuery (a "#"
    // sigil is optional), since a stored tag name never contains the "#".
    if (tagQuery !== "") {
      for (const t of tagList) {
        if (t.normalized.includes(tagQuery)) {
          record(
            "tag",
            t.id,
            t.name,
            true,
            "name",
            t.name,
            quality(t.normalized, tagQuery),
          );
        }
      }
    }
    // Tag-as-reason: substring of the tag's normalized (lowercased) name, matched
    // against the folded query (leading "#" stripped). One entity carrying several
    // matching tags — or matching a tag *and* its own name — merges into one row
    // via record(). The guard keeps an empty query from matching every tag.
    if (tagQuery !== "") {
      for (const tg of taggings) {
        if (tg.normalized.includes(tagQuery)) {
          addOwnerHit(
            tg.entity_type,
            tg.entity_id,
            "tag",
            tg.name,
            quality(tg.normalized, tagQuery),
          );
        }
      }
    }

    // Birthday: parse the term into the partial date(s) it could mean, then
    // surface every birthday consistent with a candidate (resolving to its
    // person/pet subject). A candidate matches only when every part it
    // *specifies* equals the milestone's part, so a "march" query never lights
    // up a year-only birthday, and a milestone missing a specified part drops.
    // parseBirthdayQuery returns [] for a non-date term, so the block is skipped
    // rather than matching everyone (the same empty-query guard the other facets
    // use). Birthdays only ever sit on person/pet subjects (the kind's
    // allowedSubjectTypes), so addOwnerHit resolves them all.
    const birthdayCandidates = parseBirthdayQuery(term);
    if (birthdayCandidates.length > 0) {
      for (const m of birthdays) {
        const matched = birthdayCandidates.some(
          (c) =>
            (c.month === undefined || c.month === m.month) &&
            (c.day === undefined || c.day === m.day) &&
            (c.year === undefined || c.year === m.year),
        );
        if (!matched) continue;
        addOwnerHit(
          m.subject_type,
          m.subject_id,
          "birthday",
          formatMilestoneDate(m),
          QUALITY_SUBSTRING,
        );
      }
    }

    const rows = [...acc.values()];
    rows.sort((a, b) => {
      // 1. name hits before contact-only hits.
      if (a.isName !== b.isName) return a.isName ? -1 : 1;
      // 2. match-quality bucket: exact > starts-with > substring.
      if (a.bestQuality !== b.bestQuality) return a.bestQuality - b.bestQuality;
      // 3. a tag result floats above an equally-matching entity, so when the
      //    query best matches a tag the tag leads, followed by its bearers.
      const aTag = a.hit.entityType === "tag";
      const bTag = b.hit.entityType === "tag";
      if (aTag !== bTag) return aTag ? -1 : 1;
      // 4. alphabetical by title.
      return a.hit.title.localeCompare(b.hit.title);
    });

    return rows.slice(0, MAX_RESULTS).map((r) => r.hit);
  }

  return { query };
}
