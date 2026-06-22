import {
  type DuplicateInput,
  type DuplicateTier,
  TIER_RANK,
  fold,
  normalizeEmail,
  normalizePhone,
  scoreDuplicate,
} from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

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
  /** Display name, e.g. "Jane Doe". */
  name: string;
}

/** A proposed duplicate pair: the two people, the confidence tier, and why. */
export interface DuplicateCandidate {
  a: DuplicateCandidatePerson;
  b: DuplicateCandidatePerson;
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
}

interface PersonRow {
  id: string;
  first_name: string;
  last_name: string;
}
interface ContactRow {
  owner_id: string;
  normalized: string;
}

/** The canonical `"lower:higher"` key for an unordered pair (matches the repo). */
function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export function createDuplicateService(driver: SqliteDriver): DuplicateService {
  async function findCandidates(
    excludePairs: Set<string>,
  ): Promise<DuplicateCandidate[]> {
    const [people, emails, phones] = await Promise.all([
      driver.all<PersonRow>(
        "SELECT id, first_name, last_name FROM people WHERE deleted_at IS NULL",
      ),
      driver.all<ContactRow>(
        `SELECT owner_id, normalized FROM email_addresses
          WHERE deleted_at IS NULL AND owner_type = 'person' AND normalized <> ''`,
      ),
      driver.all<ContactRow>(
        `SELECT owner_id, normalized FROM phone_numbers
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

    // Build the scorer input once per person (id kept alongside for the result).
    const inputs = people.map((p) => {
      const name = `${p.first_name} ${p.last_name}`.trim();
      const input: DuplicateInput = {
        name,
        foldedName: fold(name),
        emails: emailsBy.get(p.id) ?? [],
        phones: phonesBy.get(p.id) ?? [],
      };
      return { id: p.id, input };
    });

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

  return { findCandidates };
}
