import type { EntityType } from "./relationship.js";

/**
 * What a search result navigates to. Usually an **entity** (person or pet), but
 * a `"tag"` result targets that tag's own screen — the one facet that surfaces
 * as itself rather than resolving to the entities that carry it (those still
 * appear too, ranked just below the tag).
 */
export type SearchResultType = EntityType | "tag";

/**
 * One global-search result. Usually an **entity** (a person or pet): a match on
 * a contact method or tag resolves to the entity that owns it, and an entity
 * that matches through several facets at once is one `SearchHit` with the match
 * `reasons` merged, so the UI shows one row per entity. The exception is a
 * `"tag"` result, which represents the tag itself (its own navigable screen).
 */
export interface SearchHit {
  /** What the result navigates to — a person/pet entity, or a tag's own screen. */
  entityType: SearchResultType;
  entityId: string;
  /** Display name — a person's "first last", a pet's name, or the tag's name. */
  title: string;
  /**
   * Why this entity matched, merged across facets. Used for the "matched on …"
   * subtitle on non-name hits. `facet` is e.g. `"name"`, `"phone"`, `"email"`;
   * `matchedText` is the human-readable value to show.
   */
  reasons: { facet: string; matchedText: string }[];
}
