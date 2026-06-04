import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import { Link } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/** Path to a neighbor entity's view page, branching on its entity type. */
function neighborPath(neighbor: RelationshipNeighbor): string {
  return `${entityBasePath(neighbor.otherType)}/${neighbor.otherId}`;
}

/**
 * The Relationships section shared by the Person and Pet view screens. It lists
 * the subject's neighbors (already oriented + labelled by the IPC layer) and
 * links to add/remove, all rooted at the subject's own base path so the same
 * markup serves both entity types.
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
              <tr key={neighbor.relationshipId}>
                <td>
                  <Link to={neighborPath(neighbor)}>{neighbor.otherLabel}</Link>
                </td>
                <td>
                  {neighbor.otherRole === "other" && neighbor.otherRoleNote
                    ? neighbor.otherRoleNote
                    : neighbor.otherRoleLabel}
                </td>
                <td>
                  <Link
                    to={`${basePath}/relationships/${neighbor.relationshipId}/delete`}
                  >
                    Remove
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
