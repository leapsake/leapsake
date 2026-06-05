import type {
  EntityType,
  RelationshipNeighbor,
  RelationshipRole,
} from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { entityBasePath } from "../lib/entityLabel";

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
 * (other endpoint + base role) travels through the hidden inputs.
 */
export function RelationshipDismiss() {
  const { subject, neighbor, role } = useLoaderData() as {
    subject: Subject;
    neighbor: RelationshipNeighbor;
    role: RelationshipRole;
  };
  const subjectPath = `${entityBasePath(subject.type)}/${subject.id}`;
  const navigation = useNavigation();
  const removing = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: subject.label, to: subjectPath },
          { label: "Remove relationship" },
        ]}
      />
      <h1>Remove relationship?</h1>
      <p>
        Remove {neighbor.otherLabel} ({neighbor.otherRoleLabel.toLowerCase()})
        as a relationship of {subject.label}? This does not delete{" "}
        {neighbor.otherLabel}.
      </p>

      <Form method="post">
        <input type="hidden" name="otherType" value={neighbor.otherType} />
        <input type="hidden" name="otherId" value={neighbor.otherId} />
        <input type="hidden" name="role" value={role} />
        <fieldset disabled={removing}>
          <button type="submit">Remove</button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
