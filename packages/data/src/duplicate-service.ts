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

/** Duplicate detection over the people list: read-only, scored by
 *  {@link scoreDuplicate}. It only proposes; merges go through core. */

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

/** An existing person a not-yet-stored contact looks like, with the scorer's
 *  tier and reasons. The caller decides what to do. */
export interface DuplicateMatch {
  personId: string;
  name: string;
  tier: DuplicateTier;
  reasons: string[];
}

export interface DuplicateService {
  /** Every pair of active people not in `excludePairs` (`"lower:higher"` keys),
   *  tier `high` first; `none` and `low` are dropped. */
  findCandidates(excludePairs: Set<string>): Promise<DuplicateCandidate[]>;
  /** {@link findCandidates} minus the remembered "not a duplicate" pairs; the
   *  one place that exclusion is applied. */
  unresolvedCandidates(): Promise<DuplicateCandidate[]>;
  /** The same candidates as `"lower:higher"` keys; names never leave here. */
  unresolvedPairKeys(): Promise<string[]>;
  /** Score one not-yet-stored contact against every active person, normalizing
   *  its fields as the stored rows were. For contact import. */
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
  /** Every active **published** person as a scorer input, contacts indexed by
   *  owner. Unpublished people are out (README, "Unpublished entities"). */
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

    // Re-normalized defensively, so keys match however they were stored.
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
      // Joined, not interpolated: any name part may be absent.
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
