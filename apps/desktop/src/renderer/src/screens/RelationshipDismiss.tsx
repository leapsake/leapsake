import type {
  EntityType,
  RelationshipNeighbor,
  RelationshipRole,
} from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { entityBasePath } from "@leapsake/ui/headless";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

/** The subject entity the inferred relationship is computed for. */
interface Subject {
  type: EntityType;
  id: string;
  label: string;
}

/**
 * Confirm removing an inferred relationship. Presented identically to the
 * stored-edge Remove flow ({@link RelationshipDelete}) for a uniform end-user
 * experience; the backend handles it differently (recording a suppression rather
 * than soft-deleting a row), since the edge has no stored id — its identity
 * (other endpoint + base role) travels through the hidden fields.
 */
export function RelationshipDismiss() {
  const { subject, neighbor, role } = useLoaderData() as {
    subject: Subject;
    neighbor: RelationshipNeighbor;
    role: RelationshipRole;
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
      hiddenFields={{
        otherType: neighbor.otherType,
        otherId: neighbor.otherId,
        role,
      }}
    >
      Remove {neighbor.otherLabel} ({neighbor.otherRoleLabel.toLowerCase()}) as
      a relationship of {subject.label}? This does not delete{" "}
      {neighbor.otherLabel}.
    </ConfirmDelete>
  );
}
