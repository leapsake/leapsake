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

/**
 * The Relationships section shared by the Person and Pet view screens. It lists
 * the subject's neighbors — both stored edges and the ones the inference engine
 * computes — already oriented + labelled by the IPC layer, and presented
 * uniformly: the explicit/derived distinction is a backend detail and never
 * surfaces in the UI. Every row offers "Remove"; under the hood an explicit edge
 * is soft-deleted by id, while a derived edge is suppressed by its identity
 * (other endpoint + base role, carried in the query string since it has no id).
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

  function dismissPath(neighbor: RelationshipNeighbor): string {
    const params = new URLSearchParams({
      otherType: neighbor.otherType,
      otherId: neighbor.otherId,
      role: baseRole(neighbor.otherRole),
    });
    return `${basePath}/relationships/dismiss?${params.toString()}`;
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
                  {neighbor.origin === "explicit" ? (
                    <Link
                      to={`${basePath}/relationships/${neighbor.relationshipId}/delete`}
                    >
                      Remove
                    </Link>
                  ) : (
                    <Link to={dismissPath(neighbor)}>Remove</Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
