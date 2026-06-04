import type { Person, RelationshipNeighbor } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { fullName } from "../lib/fullName";

export function RelationshipDelete() {
  const { person, neighbor } = useLoaderData() as {
    person: Person;
    neighbor: RelationshipNeighbor;
  };
  const name = fullName(person);
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          { label: "People", to: "/" },
          { label: name, to: `/people/${person.id}` },
          { label: "Remove relationship" },
        ]}
      />
      <h1>Remove relationship?</h1>
      <p>
        Remove {neighbor.otherLabel} ({neighbor.otherRoleLabel.toLowerCase()})
        as a relationship of {name}? This does not delete {neighbor.otherLabel}.
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button>{" "}
          <Link to={`/people/${person.id}`}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
