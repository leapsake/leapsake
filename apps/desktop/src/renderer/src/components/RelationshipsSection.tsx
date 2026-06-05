import {
  type EntityType,
  type RelationshipNeighbor,
  baseRole,
} from "@leapsake/schema";
import { Link } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/** Path to a neighbor entity's view page, branching on its entity type. */
function neighborPath(neighbor: RelationshipNeighbor): string {
  return `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
}

/** A stable key for a neighbor row: the stored id, or the derived edge identity. */
function neighborKey(neighbor: RelationshipNeighbor): string {
  return neighbor.origin === "explicit"
    ? neighbor.relationshipId
    : `derived:${neighbor.otherType}:${neighbor.otherId}:${baseRole(neighbor.otherRole)}`;
}

// A derived edge has no stored id, so its identity (other endpoint + base role)
// travels in the query string the same way for both Edit and Remove.
function derivedQuery(neighbor: RelationshipNeighbor): string {
  return new URLSearchParams({
    otherType: neighbor.otherType,
    otherId: neighbor.otherId,
    role: baseRole(neighbor.otherRole),
  }).toString();
}

/**
 * The Relationships section shared by the Person and Pet view screens. It lists
 * the subject's neighbors — both stored edges and the ones the inference engine
 * computes — already oriented + labelled by the IPC layer, and presented
 * uniformly: the explicit/derived distinction is a backend detail and never
 * surfaces in the UI. Every row offers "Edit" and "Remove"; under the hood an
 * explicit edge is updated/soft-deleted by id, while a derived edge is addressed
 * by its identity (other endpoint + base role, carried in the query string since
 * it has no id) — editing it materialises a stored edge, removing it records a
 * suppression.
 */
export function RelationshipsSection({
  subjectType,
  subjectId,
  relationships,
}: {
  subjectType: EntityType;
  subjectId: string;
  relationships: RelationshipNeighbor[];
}) {
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  // Edit/Remove targets, branching on origin internally so the rendered row looks
  // identical whether the edge is stored (explicit) or inferred (derived): an
  // explicit edge is addressed by id; a derived one by its query-string identity.
  // Editing a derived edge materialises it; removing it records a suppression.
  function editPath(neighbor: RelationshipNeighbor): string {
    return neighbor.origin === "explicit"
      ? `${basePath}/relationships/${neighbor.relationshipId}/edit`
      : `${basePath}/relationships/edit?${derivedQuery(neighbor)}`;
  }

  function removePath(neighbor: RelationshipNeighbor): string {
    return neighbor.origin === "explicit"
      ? `${basePath}/relationships/${neighbor.relationshipId}/delete`
      : `${basePath}/relationships/dismiss?${derivedQuery(neighbor)}`;
  }

  return (
    <section>
      <header>
        <h2>Relationships</h2>
        <Link to={`${basePath}/relationships/new`}>Add relationship</Link>
      </header>
      {relationships.length === 0 ? (
        <p>No relationships yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {relationships.map((neighbor) => (
              <tr key={neighborKey(neighbor)}>
                <td>
                  <Link to={neighborPath(neighbor)}>{neighbor.otherLabel}</Link>
                </td>
                <td>
                  {neighbor.otherRole === "other" && neighbor.otherRoleNote
                    ? neighbor.otherRoleNote
                    : neighbor.otherRoleLabel}
                </td>
                <td>
                  <Link to={editPath(neighbor)}>Edit</Link>{" "}
                  <Link to={removePath(neighbor)}>Remove</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
