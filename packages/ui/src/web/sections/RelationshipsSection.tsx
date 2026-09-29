import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import {
  entityBasePath,
  neighborKey,
  neighborPath,
  relationshipEditPath,
  relationshipRemovePath,
} from "../../headless/routes.js";
import { useMessages } from "../../messages/index.js";
import { useUi } from "../adapter.js";
import { DataTable } from "../primitives/DataTable.js";
import { EmptyState, Section } from "../primitives/Section.js";

/**
 * A subject's relationships, stored and derived alike, each with Edit and
 * Remove; the headless route builders tell the two apart.
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
  const m = useMessages();
  const basePath = `${entityBasePath(subjectType)}/${subjectId}`;

  return (
    <Section
      title={m.relationships.title}
      actions={
        <Link href={`${basePath}/relationships/new`}>
          {m.relationships.add}
        </Link>
      }
    >
      {relationships.length === 0 ? (
        <EmptyState>{m.relationships.empty}</EmptyState>
      ) : (
        <DataTable
          items={relationships}
          getKey={neighborKey}
          columns={[
            {
              header: m.relationships.columnName,
              cell: (neighbor) => (
                <Link href={neighborPath(neighbor)}>{neighbor.otherLabel}</Link>
              ),
            },
            {
              header: m.relationships.columnRole,
              cell: (neighbor) =>
                neighbor.otherRole === "other" && neighbor.otherRoleNote
                  ? neighbor.otherRoleNote
                  : neighbor.otherRoleLabel,
            },
            {
              header: "",
              cell: (neighbor) => (
                <>
                  {/* Only a stored edge has a page. */}
                  {neighbor.origin === "explicit" && (
                    <>
                      <Link href={`/relationships/${neighbor.relationshipId}`}>
                        {m.relationships.details}
                      </Link>{" "}
                    </>
                  )}
                  <Link href={relationshipEditPath(basePath, neighbor)}>
                    {m.common.edit}
                  </Link>{" "}
                  <Link href={relationshipRemovePath(basePath, neighbor)}>
                    {m.common.remove}
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
