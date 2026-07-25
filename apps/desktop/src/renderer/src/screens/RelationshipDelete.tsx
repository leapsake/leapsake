import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { entityBasePath } from "../lib/entityLabel";
import { useSubmitting } from "../lib/useSubmitting";

/** The subject entity the relationship being removed hangs off of. */
interface Subject {
  type: EntityType;
  id: string;
  label: string;
}

export function RelationshipDelete() {
  const { subject, neighbor } = useLoaderData() as {
    subject: Subject;
    neighbor: RelationshipNeighbor;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;

  return (
    <ConfirmDelete
      trail={[
        homeCrumb,
        { label: subject.label, to: subjectPath },
        { label: "Remove relationship" },
      ]}
      heading="Remove relationship?"
      confirmLabel="Remove"
      cancelTo={subjectPath}
      submitting={useSubmitting()}
    >
      Remove {neighbor.otherLabel} ({neighbor.otherRoleLabel.toLowerCase()}) as
      a relationship of {subject.label}? This does not delete{" "}
      {neighbor.otherLabel}.
    </ConfirmDelete>
  );
}
