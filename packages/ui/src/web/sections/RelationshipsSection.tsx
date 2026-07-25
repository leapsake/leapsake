import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import {
  entityBasePath,
  neighborKey,
  neighborPath,
  relationshipEditPath,
  relationshipRemovePath,
} from "../../headless/routes.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * The Relationships section shared by the Person and Pet view screens. It lists
 * the subject's neighbors — both stored edges and the ones the inference engine
 * computes — already oriented + labelled by the data layer, and presented
 * uniformly: the explicit/derived distinction is a backend detail and never
 * surfaces in the UI. Every row offers “Edit” and “Remove”; under the hood an
 * explicit edge is updated/soft-deleted by id, while a derived edge is addressed
 * by its identity (other endpoint + base role) — editing it materialises a
 * stored edge, removing it records a suppression. Those path decisions live in
 * `@leapsake/ui/headless`'s route builders, not here.
 */
export function RelationshipsSection({
  subjectType,
  subjectId,
  relationships,
}: {
  subjectType: EntityType;
  subjectId: string;
  relationships: readonly RelationshipNeighbor[];
}) {
  const { Link } = useUi();
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  return (
    <Section
      title="Relationships"
      actions={
        <Link href={`${basePath}/relationships/new`}>Add relationship</Link>
      }
    >
      {relationships.length === 0 ? (
        <EmptyState>No relationships yet.</EmptyState>
      ) : (
        <DataTable
          items={relationships}
          getKey={neighborKey}
          columns={[
            {
              header: "Name",
              cell: (neighbor) => (
                <Link href={neighborPath(neighbor)}>{neighbor.otherLabel}</Link>
              ),
            },
            {
              header: "Role",
              cell: (neighbor) =>
                neighbor.otherRole === "other" && neighbor.otherRoleNote
                  ? neighbor.otherRoleNote
                  : neighbor.otherRoleLabel,
            },
            {
              header: "",
              cell: (neighbor) => (
                <>
                  {/* Only a stored edge has a relationship page to open; a
                      derived edge has no id and must be materialised first. */}
                  {neighbor.origin === "explicit" && (
                    <>
                      <Link href={`/relationships/${neighbor.relationshipId}`}>
                        Details
                      </Link>{" "}
                    </>
                  )}
                  <Link href={relationshipEditPath(basePath, neighbor)}>
                    Edit
                  </Link>{" "}
                  <Link href={relationshipRemovePath(basePath, neighbor)}>
                    Remove
                  </Link>
                </>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}
