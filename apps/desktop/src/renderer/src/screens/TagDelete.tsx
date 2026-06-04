import type { Tag } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

export function TagDelete() {
  const { tag, count } = useLoaderData() as { tag: Tag; count: number };
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: tag.name, to: `/tags/${tag.id}` },
          { label: "Delete" },
        ]}
      />
      <h1>Delete "{tag.name}"?</h1>
      <p>
        This removes the tag from{" "}
        {count === 0
          ? "everything"
          : `${count} ${count === 1 ? "entity" : "entities"}`}{" "}
        currently tagged with it. The tagged items themselves are not deleted.
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Delete</button>{" "}
          <Link to={`/tags/${tag.id}`}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
