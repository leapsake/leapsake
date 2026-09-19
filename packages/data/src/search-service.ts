import {
  PUBLISHED_SQL,
  type SearchHit,
  type SearchResultType,
  digits,
  fold,
  foldAddress,
  formatMilestoneDate,
  formatPostalAddress,
  foldUrl,
  joinNameParts,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
  parseBirthdayQuery,
} from "@leapsake/schema";
import { findPlatform } from "@leapsake/contact-links";
import type { SqliteDriver } from "./driver.js";

// Re-exported from `@leapsake/schema` for this module's callers.
export { parseBirthdayQuery };

/** Shortest query we act on; anything shorter returns nothing. */
const MIN_QUERY_LENGTH = 2;

/** Upper bound on results returned per query. */
const MAX_RESULTS = 50;

/** Match-quality of a folded candidate field against a folded term. Lower is
 *  better. */
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

/** A `(type, id)` accumulator key; a `"tag"` key never collides with a person
 *  or pet id, so tags group apart from what they tag. */
const key = (type: SearchResultType, id: string) => `${type}:${id}`;

export interface SearchService {
  /** People and pets matching `term` by name or owned contact, plus the facets
   *  with their own screens; one hit per entity, reasons merged. */
  query(term: string): Promise<SearchHit[]>;
}

interface PersonRow {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
}
interface PetRow {
  id: string;
  name: string;
}
/** An entity that exists only as a fact about another, joined to it; the name
 *  columns of whichever type it isn't come back null. */
interface AttachedRow {
  id: string;
  type: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  pet_name: string | null;
  anchor_type: string;
  anchor_id: string;
}
/** The contact-method columns search matches (`normalized`) and displays
 *  (`address`). */
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
/** Postal columns: matched as one folded blob, displayed via
 *  `formatPostalAddress`. */
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
/** Social columns: matched on `normalized`, shown with the platform name. */
interface SocialMatchRow {
  owner_type: string;
  owner_id: string;
  platform: string;
  handle: string;
  normalized: string;
}
/** A tagging joined to its tag: matched on `normalized`, shown as `name`. */
interface TagMatchRow {
  bearer_type: string;
  bearer_id: string;
  name: string;
  normalized: string;
}
/** A tag itself, surfaced as its own navigable result (matched on
 *  `normalized`). */
interface TagRow {
  id: string;
  name: string;
  normalized: string;
}
/** A birthday: matched on its partial date, resolved to its bearer. */
interface BirthdayMatchRow {
  bearer_type: string;
  bearer_id: string;
  year: number | null;
  month: number | null;
  day: number | null;
}
/** A holiday as its own result; its name is folded at read time. */
interface HolidayRow {
  id: string;
  name: string;
}
/** A gift idea, as its own result and as a tag's owner. Matched on its folded
 *  title and its `url`, the half-remembered link. */
interface GiftIdeaRow {
  id: string;
  title: string;
  url: string | null;
}

/** An accumulating result row plus the keys we sort on. */
interface Accumulator {
  hit: SearchHit;
  /** True for a name match; contact-only matches (phone/email) sort after
   *  these. */
  isName: boolean;
  /** Best (lowest) match-quality bucket across all matched fields. */
  bestQuality: number;
}

/** Global search: load the small set of active rows and match in memory. */
export function createSearchService(driver: SqliteDriver): SearchService {
  async function query(term: string): Promise<SearchHit[]> {
    if (term.trim().length < MIN_QUERY_LENGTH) return [];
    // Trimmed, so "harry " still matches what "harry" did.
    const folded = fold(term).trim();
    const emailQuery = normalizeEmail(term); // trimmed + lowercased
    const phoneQuery = normalizePhone(term); // leading "+" + digits only
    const addressQuery = foldAddress(term); // comma/whitespace-insensitive
    const urlQuery = foldUrl(term); // scheme- and "www."-insensitive
    const tagQuery = folded.replace(/^#+/, ""); // the "#" sigil is optional here
    // Handles are stored without the "@", so a typed one is stripped.
    const handleQuery = normalizeHandle(term).replace(/^@+/, "");

    const [
      people,
      pets,
      emails,
      phones,
      postals,
      socials,
      taggings,
      tagList,
      birthdays,
      holidays,
      giftIdeas,
      attached,
    ] = await Promise.all([
      // Published only; an unpublished entity is found through `attached`
      // below.
      driver.all<PersonRow>(
        `SELECT id, first_name, middle_name, last_name FROM people
          WHERE deleted_at IS NULL AND ${PUBLISHED_SQL}`,
      ),
      driver.all<PetRow>(
        `SELECT id, name FROM pets WHERE deleted_at IS NULL AND ${PUBLISHED_SQL}`,
      ),
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
      driver.all<SocialMatchRow>(
        `SELECT owner_type, owner_id, platform, handle, normalized
           FROM social_profiles WHERE deleted_at IS NULL`,
      ),
      driver.all<TagMatchRow>(
        `SELECT g.bearer_type, g.bearer_id, t.name, t.normalized
           FROM taggings g JOIN tags t ON t.id = g.tag_id
          WHERE g.deleted_at IS NULL AND t.deleted_at IS NULL`,
      ),
      driver.all<TagRow>(
        "SELECT id, name, normalized FROM tags WHERE deleted_at IS NULL",
      ),
      driver.all<BirthdayMatchRow>(
        `SELECT bearer_type, bearer_id, year, month, day
             FROM milestones
            WHERE kind = 'birthday' AND deleted_at IS NULL`,
      ),
      // Hidden holidays included: search is the fastest way back to unhide one.
      driver.all<HolidayRow>(
        "SELECT id, name FROM holidays WHERE deleted_at IS NULL",
      ),
      driver.all<GiftIdeaRow>(
        "SELECT id, title, url FROM gift_ideas WHERE deleted_at IS NULL",
      ),
      // Entities that exist only as facts about another, joined to it. The
      // `CASE`s orient each edge: the anchor is the end that isn't the entity.
      driver.all<AttachedRow>(
        `SELECT e.id, e.type, e.first_name, e.middle_name, e.last_name,
                e.pet_name, r.anchor_type, r.anchor_id
           FROM (
             SELECT id, 'person' AS type, first_name, middle_name, last_name,
                    NULL AS pet_name
               FROM people
              WHERE deleted_at IS NULL AND standing = 'unpublished'
             UNION ALL
             SELECT id, 'pet' AS type, NULL, NULL, NULL, name
               FROM pets
              WHERE deleted_at IS NULL AND standing = 'unpublished'
           ) e
           JOIN (
             SELECT a_type AS self_type, a_id AS self_id,
                    b_type AS anchor_type, b_id AS anchor_id
               FROM relationships WHERE deleted_at IS NULL
             UNION ALL
             SELECT b_type, b_id, a_type, a_id
               FROM relationships WHERE deleted_at IS NULL
           ) r ON r.self_type = e.type AND r.self_id = e.id`,
      ),
    ]);

    const acc = new Map<string, Accumulator>();
    /** `(type, id) → title` for every active entity; a contact whose owner is
     *  not here is dropped. */
    const titleByEntity = new Map<
      string,
      { type: SearchResultType; title: string }
    >();

    /** Record or merge a match on an entity's row. `isName` only flips on, and
     *  `bestQuality` only improves. */
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

    /** Record a name match if any candidate matches. Callers pass whole-name
     *  forms too, since "harry bailey" is a substring of no single part. */
    const addNameHit = (
      type: SearchResultType,
      id: string,
      title: string,
      candidates: readonly (string | null)[],
    ) => {
      let best = QUALITY_NONE;
      for (const candidate of candidates) {
        if (candidate == null || candidate === "") continue;
        best = Math.min(best, quality(fold(candidate), folded));
      }
      if (best === QUALITY_NONE) return; // no field matched
      record(type, id, title, true, "name", title, best);
    };

    for (const p of people) {
      // The middle name shows only when the term matched it. Parts are joined,
      // not interpolated, since any may be absent.
      const middle = p.middle_name ?? "";
      const plain = joinNameParts(p.first_name, p.last_name);
      // The owner-resolution title (for contact-only hits) is always the plain
      // form — the middle name is only relevant when the *name* matched it.
      titleByEntity.set(key("person", p.id), {
        type: "person",
        // A person whose only name is their middle one would otherwise resolve
        // to an empty row title (the same fallback `fullName` makes).
        title: plain === "" ? middle : plain,
      });
      const withMiddle = joinNameParts(p.first_name, middle, p.last_name);
      const showMiddle =
        middle !== "" &&
        (fold(middle).includes(folded) ||
          // Or the term spans the middle name ("joseph abraham"), which only
          // the with-middle whole name can match — the same reason to show it.
          (fold(withMiddle).includes(folded) && !fold(plain).includes(folded)));
      const title = showMiddle ? withMiddle : plain;
      // Parts, then whole names with and without the middle name, so a
      // full-name match keeps the quality of its best part.
      addNameHit("person", p.id, title, [
        p.first_name,
        middle,
        p.last_name,
        plain,
        withMiddle,
      ]);
    }
    for (const pet of pets) {
      titleByEntity.set(key("pet", pet.id), { type: "pet", title: pet.name });
      addNameHit("pet", pet.id, pet.name, [pet.name]);
    }
    // A gift idea is its own result, registered before the tag pass so it can
    // also own a matching tag.
    for (const idea of giftIdeas) {
      titleByEntity.set(key("gift_idea", idea.id), {
        type: "gift_idea",
        title: idea.title,
      });
      addNameHit("gift_idea", idea.id, idea.title, [idea.title]);
      // A link match is a reason, not a name, so it sorts below title hits.
      if (idea.url !== null && urlQuery !== "") {
        const haystack = foldUrl(idea.url);
        const q = quality(haystack, urlQuery);
        if (q !== QUALITY_NONE) {
          record("gift_idea", idea.id, idea.title, false, "link", idea.url, q);
        }
      }
    }

    /** Resolve a matched contact to its owner (dropping unresolvable ones) and
     *  merge `matchedText` in as the reason. */
    const addOwnerHit = (
      ownerType: string,
      ownerId: string,
      facet: string,
      matchedText: string,
      matchQuality: number,
    ) => {
      const owner = titleByEntity.get(
        key(ownerType as SearchResultType, ownerId),
      );
      // No entry means the owner isn't searchable: soft-deleted, a household,
      // or a bearer type with no results of its own yet (a tagged reminder).
      if (!owner) return;
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

    // An attached entity matches as a facet of its anchor, whose page is the
    // only place it is read. Runs after the passes that fill `titleByEntity`.
    for (const row of attached) {
      const name =
        row.type === "person"
          ? joinNameParts(row.first_name, row.middle_name, row.last_name)
          : (row.pet_name ?? "");
      if (name === "") continue;
      const q = quality(fold(name), folded);
      if (q === QUALITY_NONE) continue;
      addOwnerHit(row.anchor_type, row.anchor_id, "relationship", name, q);
    }

    // Email: forward substring of the normalized address.
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
    // Phone: digits only, matched either direction so a country code or "+"
    // does not matter. Only when the query has digits.
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
    // Postal: substring of the folded one-line address; the guard stops a
    // punctuation-only query matching every address.
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
    // Social handles: forward substring, like email. The reason carries the
    // platform, so shared handles on different networks are told apart.
    if (handleQuery !== "") {
      for (const so of socials) {
        if (so.normalized === "" || !so.normalized.includes(handleQuery)) {
          continue;
        }
        addOwnerHit(
          so.owner_type,
          so.owner_id,
          "social",
          `${findPlatform(so.platform)?.name ?? so.platform} · ${so.handle}`,
          quality(so.normalized, handleQuery),
        );
      }
    }
    // Tag as its own result: a name hit on the tag, floated above its bearers
    // by the sort. Active tags always have a bearer.
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
    // Tag as a reason: an entity carrying a matching tag, merged via `record`.
    if (tagQuery !== "") {
      for (const tg of taggings) {
        if (tg.normalized.includes(tagQuery)) {
          addOwnerHit(
            tg.bearer_type,
            tg.bearer_id,
            "tag",
            tg.name,
            quality(tg.normalized, tagQuery),
          );
        }
      }
    }

    // Birthdays: every part a candidate date specifies must equal the
    // milestone's. A non-date term parses to no candidates, so nothing matches.
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
          m.bearer_type,
          m.bearer_id,
          "birthday",
          formatMilestoneDate(m),
          QUALITY_SUBSTRING,
        );
      }
    }

    // Holiday as its own result. No holiday-as-reason pass: forty observers of
    // Christmas would bury everything else.
    for (const h of holidays) {
      const foldedName = fold(h.name);
      const q = quality(foldedName, folded);
      if (q === QUALITY_NONE) continue;
      record("holiday", h.id, h.name, true, "name", h.name, q);
    }

    const rows = [...acc.values()];
    rows.sort((a, b) => {
      // 1. name hits before contact-only hits.
      if (a.isName !== b.isName) return a.isName ? -1 : 1;
      // 2. match-quality bucket: exact > starts-with > substring.
      if (a.bestQuality !== b.bestQuality) return a.bestQuality - b.bestQuality;
      // 3. A tag or holiday floats above an equal entity, leading its members.
      // A    gift idea leads nothing, so it stays alphabetical.
      const ownScreen = (t: SearchResultType) => t === "tag" || t === "holiday";
      const aOwn = ownScreen(a.hit.entityType);
      const bOwn = ownScreen(b.hit.entityType);
      if (aOwn !== bOwn) return aOwn ? -1 : 1;
      // 4. alphabetical by title.
      return a.hit.title.localeCompare(b.hit.title);
    });

    return rows.slice(0, MAX_RESULTS).map((r) => r.hit);
  }

  return { query };
}
