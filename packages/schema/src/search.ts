import type { EntityType } from "./relationship.js";

/**
 * One global-search result. Always an **entity** (a person or pet), never a
 * facet: a match on a contact method resolves to the entity that owns it. A
 * single entity that matches through several facets at once is one `SearchHit`
 * with the match `reasons` merged, so the UI shows one row per entity.
 */
export interface SearchHit {
  /** What the result navigates to. */
  entityType: EntityType;
  entityId: string;
  /** Display name — a person's "first last" or a pet's name. */
  title: string;
  /**
   * Why this entity matched, merged across facets. Used for the "matched on …"
   * subtitle on non-name hits. `facet` is e.g. `"name"`, `"phone"`, `"email"`;
   * `matchedText` is the human-readable value to show.
   */
  reasons: { facet: string; matchedText: string }[];
}
