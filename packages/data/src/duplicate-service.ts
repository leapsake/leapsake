import {
  type DuplicateInput,
  type DuplicateTier,
  PUBLISHED_SQL,
  TIER_RANK,
  fold,
  joinNameParts,
  normalizeEmail,
  normalizeHandle,
  normalizePhone,
  scoreDuplicate,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";
import type { NotADuplicateRepo } from "./not-a-duplicate-repo.js";

/**
 * Duplicate *detection* over the people list — the read half of reconciliation
 * Increment B (packages/core/README.md). A read-only cross-table
 * aggregator in the same shape as {@link createSearchService}: pull the small set
 * of active rows, derive in memory, and hand each candidate pair to the pure
 * {@link scoreDuplicate}. It only *proposes* — every actual merge still goes
 * through `core.people.merge` behind a confirm.
 */

/** One person in a candidate pair, with enough to display and to act on. */
export interface DuplicateCandidatePerson {
  id: string;
  /** Display name, e.g. "Jane Wainwright". */
  name: string;
}

/** A proposed duplicate pair: the two people, the confidence tier, and why. */
export interface DuplicateCandidate {
  a: DuplicateCandidatePerson;
  b: DuplicateCandidatePerson;
  tier: DuplicateTier;
  reasons: string[];
}

/**
 * An existing person a not-yet-stored contact (e.g. one being imported) looks
 * like: which person, and the pure scorer's tier + reasons. Same `propose, never
 * auto-act` contract — the importer decides whether to skip or merge.
 */
export interface DuplicateMatch {
  personId: string;
  name: string;
  tier: DuplicateTier;
  reasons: string[];
}

export interface DuplicateService {
  /**
   * Score every pair of active people, drop the pairs the caller already
   * remembers as "not a duplicate" (the `"lower:higher"` keys from
   * `notADuplicate.listPairs()`), and return the rest sorted by tier (high
   * first). Tier `none`/`low` never appears in the result.
   */
  findCandidates(excludePairs: Set<string>): Promise<DuplicateCandidate[]>;
  /**
   * The unresolved candidates: {@link DuplicateService.findCandidates} over the
   * pairs this device has already been told are not the same. The one place that
   * exclusion is applied, so `duplicates.*` and the Home nudge cannot disagree
   * about what is still outstanding.
   */
  unresolvedCandidates(): Promise<DuplicateCandidate[]>;
  /**
   * The same candidates as canonical `"lower:higher"` pair keys — the identity
   * the Home nudge is content-addressed on. Names never leave this layer.
   */
  unresolvedPairKeys(): Promise<string[]>;
  /**
   * Score one **not-yet-stored** contact against every active person and return
   * the matches (tier `none`/`low` dropped), high first. Used by contact import
   * to flag likely-existing people in the review before anything is written. The
   * caller passes raw name/emails/phones/handles; this normalizes them the same
   * way the stored rows were, so keys line up.
   */
  matchContact(contact: {
    name: string;
    emails: string[];
    phones: string[];
    handles: { platform: string; handle: string }[];
  }): Promise<DuplicateMatch[]>;
}

interface PersonRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
}
interface ContactRow {
  owner_id: string;
  normalized: string;
}

/** As {@link ContactRow}, carrying the platform a handle only means anything on. */
interface SocialRow {
  owner_id: string;
  platform: string;
  normalized: string;
}

/** The canonical `"lower:higher"` key for an unordered pair (matches the repo). */
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export function createDuplicateService(
  driver: SqliteDriver,
  repos: { notADuplicate: NotADuplicateRepo },
): DuplicateService {
  /**
   * Load every active **published** person as a ready {@link DuplicateInput} (id
   * kept alongside), with contacts indexed by owner and re-normalized
   * defensively. Shared by {@link findCandidates} (pairwise) and
   * {@link matchContact} (one-vs-all).
   *
   * Unpublished people are out of the pool on purpose. They exist only as facts
   * about somebody else and are offered by no picker, so the same name arriving
   * twice means two different people — a "Ruth" on one coworker and a "Ruth" on
   * another are not a pair to review, and with names now allowed to be a single
   * word they would collide constantly. Detection is instead run at the moment
   * one is promoted, when they first become someone the user can pick and there
   * is a real question of whether they are already in the list.
   */
  async function loadInputs(): Promise<
    { id: string; input: DuplicateInput }[]
  > {
    const [people, emails, phones, socials] = await Promise.all([
      driver.all<PersonRow>(
        `SELECT id, first_name, last_name FROM people
          WHERE deleted_at IS NULL AND ${PUBLISHED_SQL}`,
      ),
      driver.all<ContactRow>(
        `SELECT owner_id, normalized FROM email_addresses
          WHERE deleted_at IS NULL AND owner_type = 'person' AND normalized <> ''`,
      ),
      driver.all<ContactRow>(
        `SELECT owner_id, normalized FROM phone_numbers
          WHERE deleted_at IS NULL AND owner_type = 'person' AND normalized <> ''`,
      ),
      driver.all<SocialRow>(
        `SELECT owner_id, platform, normalized FROM social_profiles
          WHERE deleted_at IS NULL AND owner_type = 'person' AND normalized <> ''`,
      ),
    ]);

    // Index normalized contacts by owner so the scorer gets ready arrays. The
    // columns are already normalized at write time, but re-normalize defensively
    // so the keys match exactly however they were stored.
    const emailsBy = new Map<string, string[]>();
    for (const row of emails) {
      const list = emailsBy.get(row.owner_id) ?? [];
      list.push(normalizeEmail(row.normalized));
      emailsBy.set(row.owner_id, list);
    }
    const phonesBy = new Map<string, string[]>();
    for (const row of phones) {
      const list = phonesBy.get(row.owner_id) ?? [];
      list.push(normalizePhone(row.normalized));
      phonesBy.set(row.owner_id, list);
    }

    const handlesBy = new Map<string, { platform: string; handle: string }[]>();
    for (const row of socials) {
      const list = handlesBy.get(row.owner_id) ?? [];
      list.push({
        platform: row.platform,
        handle: normalizeHandle(row.normalized),
      });
      handlesBy.set(row.owner_id, list);
    }

    return people.map((p) => {
      // Any part of a name may be absent, so the parts are joined rather than
      // interpolated — otherwise a surname-only person folds to " davis" and
      // matches nothing, including the identical person entered the other way.
      const name = joinNameParts(p.first_name, p.last_name);
      const input: DuplicateInput = {
        name,
        foldedName: fold(name),
        emails: emailsBy.get(p.id) ?? [],
        phones: phonesBy.get(p.id) ?? [],
        handles: handlesBy.get(p.id) ?? [],
      };
      return { id: p.id, input };
    });
  }

  async function findCandidates(
    excludePairs: Set<string>,
  ): Promise<DuplicateCandidate[]> {
    const inputs = await loadInputs();

    // Pairwise. O(n²) is fine at personal-CRM scale; if it ever matters, block on
    // shared-contact / folded-name first — note it, don't pre-optimize.
    const candidates: DuplicateCandidate[] = [];
    for (let i = 0; i < inputs.length; i++) {
      for (let j = i + 1; j < inputs.length; j++) {
        const left = inputs[i];
        const right = inputs[j];
        if (excludePairs.has(pairKey(left.id, right.id))) continue;
        const { tier, reasons } = scoreDuplicate(left.input, right.input);
        if (tier === "none" || tier === "low") continue;
        candidates.push({
          a: { id: left.id, name: left.input.name },
          b: { id: right.id, name: right.input.name },
          tier,
          reasons,
        });
      }
    }

    // High first, then a stable name ordering so the list doesn't reshuffle.
    candidates.sort(
      (x, y) =>
        TIER_RANK[x.tier] - TIER_RANK[y.tier] ||
        x.a.name.localeCompare(y.a.name) ||
        x.b.name.localeCompare(y.b.name),
    );
    return candidates;
  }

  async function matchContact(contact: {
    name: string;
    emails: string[];
    phones: string[];
    handles: { platform: string; handle: string }[];
  }): Promise<DuplicateMatch[]> {
    const name = contact.name.trim();
    const incoming: DuplicateInput = {
      name,
      foldedName: fold(name),
      emails: contact.emails.map(normalizeEmail),
      phones: contact.phones.map(normalizePhone),
      handles: contact.handles.map((h) => ({
        platform: h.platform,
        handle: normalizeHandle(h.handle),
      })),
    };

    const inputs = await loadInputs();
    const matches: DuplicateMatch[] = [];
    for (const person of inputs) {
      const { tier, reasons } = scoreDuplicate(incoming, person.input);
      if (tier === "none" || tier === "low") continue;
      matches.push({
        personId: person.id,
        name: person.input.name,
        tier,
        reasons,
      });
    }
    matches.sort(
      (x, y) =>
        TIER_RANK[x.tier] - TIER_RANK[y.tier] || x.name.localeCompare(y.name),
    );
    return matches;
  }

  const unresolvedCandidates = (): Promise<DuplicateCandidate[]> =>
    repos.notADuplicate.listPairs().then(findCandidates);

  return {
    findCandidates,
    matchContact,
    unresolvedCandidates,
    unresolvedPairKeys: async () =>
      (await unresolvedCandidates()).map(({ a, b }) => pairKey(a.id, b.id)),
  };
}
