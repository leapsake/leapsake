import {
  type MilestoneBearerType,
  type RelationshipNeighbor,
  type SearchHit,
  baseRole,
} from "@leapsake/schema";

// Where entities live in the URL space, shared by desktop and web. Components
// take paths as data and never build one.

/** Base path for a milestone bearer's pages, relationships included. */
export function entityBasePath(type: MilestoneBearerType): string {
  if (type === "pet") return "/pets";
  if (type === "relationship") return "/relationships";
  return "/people";
}

/** A neighbor entity's own view page. */
export function neighborPath(neighbor: RelationshipNeighbor): string {
  return `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
}

/** A neighbor row's React key: the stored id, or a derived edge's identity. */
export function neighborKey(neighbor: RelationshipNeighbor): string {
  return neighbor.origin === "explicit"
    ? neighbor.relationshipId
    : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
}

/** A derived edge's identity, which has no stored id: other end and role. */
function derivedQuery(neighbor: RelationshipNeighbor): string {
  return new URLSearchParams({
    otherType: neighbor.otherType,
    otherId: neighbor.otherId,
    role: baseRole(neighbor.otherRole),
  }).toString();
}

/** Where a row's Edit goes: by id, or by identity for a derived edge, which
 *  editing then stores. */
export function relationshipEditPath(
  subjectBasePath: string,
  neighbor: RelationshipNeighbor,
): string {
  return neighbor.origin === "explicit"
    ? `${subjectBasePath}/relationships/${neighbor.relationshipId}/edit`
    : `${subjectBasePath}/relationships/edit?${derivedQuery(neighbor)}`;
}

/** Where a row's Remove goes: a soft delete, or a suppression if derived. */
export function relationshipRemovePath(
  subjectBasePath: string,
  neighbor: RelationshipNeighbor,
): string {
  return neighbor.origin === "explicit"
    ? `${subjectBasePath}/relationships/${neighbor.relationshipId}/delete`
    : `${subjectBasePath}/relationships/dismiss?${derivedQuery(neighbor)}`;
}

/** The screen a search hit opens; a gift idea opens its edit screen. */
export function searchHitPath(hit: SearchHit): string {
  switch (hit.entityType) {
    case "tag":
      return `/tags/${hit.entityId}`;
    case "holiday":
      return `/holidays/${hit.entityId}`;
    case "gift_idea":
      return `/gifts/${hit.entityId}/edit`;
    default:
      return `${entityBasePath(hit.entityType)}/${hit.entityId}`;
  }
}
