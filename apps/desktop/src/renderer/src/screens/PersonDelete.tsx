import type { Person, Tag } from "@leapsake/schema";
import { fullName } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

export function PersonDelete() {
  const { person } = useLoaderData() as { person: Person; tags: Tag[] };
  const name = fullName(person);
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: name, to: `/people/${person.id}` }]}
      />
      <h1>Delete {name}?</h1>
      <p>Are you sure you want to delete {name}?</p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Delete</button>{" "}
          <Link to={`/people/${person.id}`}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
