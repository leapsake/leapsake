import type { EntityType, SearchHit } from "@leapsake/schema";
import type { SqliteDriver } from "./driver.js";

/**
 * Shortest query we act on. Below this we return nothing, keeping the
 * truly-empty case quiet without per-facet length rules. A named constant so
 * tuning it is a one-line change.
 */
const MIN_QUERY_LENGTH = 2;

/** Upper bound on results returned per query. */
const MAX_RESULTS = 50;

/**
 * Accent + case folding so `"jose"` matches `"José"`. Both the query and every
 * candidate are folded before matching — uniform, false-positive-friendly
 * (better to over-surface than to miss).
 */
const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

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

/** A `(type, id)` accumulator-map key. */
const key = (type: EntityType, id: string) => `${type}:${id}`;

export interface SearchService {
  /**
   * Find people and pets matching `term`. Loads the active rows and matches
   * them in memory (no SQL `LIKE`, no index), resolves every hit to its owning
   * entity, groups by `(entityType, entityId)`, and returns one `SearchHit` per
   * entity. Returns `[]` for queries shorter than {@link MIN_QUERY_LENGTH}.
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

/** An accumulating result row plus the keys we sort on. */
interface Accumulator {
  hit: SearchHit;
  /** True for a name match; contact matches (Phase 2) sort after these. */
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

    const [people, pets] = await Promise.all([
      driver.all<PersonRow>(
        "SELECT id, first_name, middle_name, last_name FROM people WHERE deleted_at IS NULL",
      ),
      driver.all<PetRow>("SELECT id, name FROM pets WHERE deleted_at IS NULL"),
    ]);

    const acc = new Map<string, Accumulator>();

    /** Record (or merge) a name match against an entity's grouped row. */
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
      const k = key(type, id);
      const existing = acc.get(k);
      if (existing) {
        existing.isName = true;
        existing.bestQuality = Math.min(existing.bestQuality, best);
        existing.hit.reasons.push({ facet: "name", matchedText: title });
        return;
      }
      acc.set(k, {
        hit: {
          entityType: type,
          entityId: id,
          title,
          reasons: [{ facet: "name", matchedText: title }],
        },
        isName: true,
        bestQuality: best,
      });
    };

    for (const p of people) {
      const title = `${p.first_name} ${p.last_name}`;
      addNameHit("person", p.id, title, [
        p.first_name,
        p.middle_name ?? "",
        p.last_name,
      ]);
    }
    for (const pet of pets) {
      addNameHit("pet", pet.id, pet.name, [pet.name]);
    }

    const rows = [...acc.values()];
    rows.sort((a, b) => {
      // 1. name hits before contact hits (all name in Phase 1).
      if (a.isName !== b.isName) return a.isName ? -1 : 1;
      // 2. match-quality bucket: exact > starts-with > substring.
      if (a.bestQuality !== b.bestQuality) return a.bestQuality - b.bestQuality;
      // 3. alphabetical by title.
      return a.hit.title.localeCompare(b.hit.title);
    });

    return rows.slice(0, MAX_RESULTS).map((r) => r.hit);
  }

  return { query };
}
