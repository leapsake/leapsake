import {
  type MilestoneBearerType,
  type RelationshipNeighbor,
  baseRole,
} from "@leapsake/schema";

/**
 * Where entities live in the URL space.
 *
 * These are shared rather than app-local because desktop and the web app
 * address the same screens the same way — desktop's hash router changes only how
 * a path is serialised into the location bar, not what the path is. Keeping them
 * here also keeps them *out* of the presentational components, which take paths
 * as data: deciding a URL is application policy, and a component that builds one
 * has quietly taken on routing.
 */

/**
 * Base route path for a milestone bearer's view/edit/delete pages. Accepts the
 * wider {@link MilestoneBearerType} so the milestone routes can target a
 * relationship's detail page too; person/pet callers are unaffected.
 */
export function entityBasePath(type: MilestoneBearerType): string {
  if (type === "pet") return "/pets";
  if (type === "relationship") return "/relationships";
  return "/people";
}

/** A neighbor entity's own view page. */
export function neighborPath(neighbor: RelationshipNeighbor): string {
  return `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
}

/** A stable React key for a neighbor row: the stored id, or the derived edge identity. */
export function neighborKey(neighbor: RelationshipNeighbor): string {
  return neighbor.origin === "explicit"
    ? neighbor.relationshipId
    : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
}

/**
 * A derived edge has no stored id, so its identity — the other endpoint plus the
 * base role — travels in the query string instead, the same way for both Edit
 * and Remove.
 */
function derivedQuery(neighbor: RelationshipNeighbor): string {
  return new URLSearchParams({
    otherType: neighbor.otherType,
    otherId: neighbor.otherId,
    role: baseRole(neighbor.otherRole),
  }).toString();
}

/**
 * Where a row's Edit goes. Branching on origin here is what lets the rendered row
 * look identical whether the edge is stored or inferred: an explicit edge is
 * addressed by id, a derived one by its query-string identity — and editing a
 * derived edge materialises it as a stored one.
 */
export function relationshipEditPath(
  subjectBasePath: string,
  neighbor: RelationshipNeighbor,
): string {
  return neighbor.origin === "explicit"
    ? `${subjectBasePath}/relationships/${neighbor.relationshipId}/edit`
    : `${subjectBasePath}/relationships/edit?${derivedQuery(neighbor)}`;
}

/**
 * Where a row's Remove goes. An explicit edge is soft-deleted by id; a derived
 * one has nothing to delete, so removing it records a suppression instead.
 */
export function relationshipRemovePath(
  subjectBasePath: string,
  neighbor: RelationshipNeighbor,
): string {
  return neighbor.origin === "explicit"
    ? `${subjectBasePath}/relationships/${neighbor.relationshipId}/delete`
    : `${subjectBasePath}/relationships/dismiss?${derivedQuery(neighbor)}`;
}
