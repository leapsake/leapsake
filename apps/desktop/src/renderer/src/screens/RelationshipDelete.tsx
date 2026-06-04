import type { EntityType, RelationshipNeighbor } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { entityBasePath } from "../lib/entityLabel";

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
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

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
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to={subjectPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
