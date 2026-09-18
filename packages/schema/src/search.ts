import type { EntityType } from "./relationship.js";

/**
 * What a search result opens: a person or pet, or a tag, holiday or gift idea's
 * own screen. Only a tag also lists the entities behind it.
 */
export type SearchResultType = EntityType | "tag" | "holiday" | "gift_idea";

/**
 * One search result. An entity matching through several facets is one hit with
 * its `reasons` merged.
 */
export interface SearchHit {
  /** What the result opens. */
  entityType: SearchResultType;
  entityId: string;
  /** The display name of the person, pet, or other result. */
  title: string;
  /** Why it matched, per facet, for the "matched on …" subtitle. */
  reasons: { facet: string; matchedText: string }[];
}
