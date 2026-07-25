import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

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
        { label: subject.label, href: subjectPath },
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
