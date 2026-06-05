import type { EntityType } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

/** One endpoint of the relationship being removed. */
interface Partner {
  type: EntityType;
  id: string;
  label: string;
}

/**
 * Remove a relationship as a whole, addressed by the relationship itself. A
 * relationship is a single shared row, so this removes it for *both* partners at
 * once — unlike the subject-scoped remove reached from one person's page, which
 * frames it as dropping a single neighbor. Neither partner entity is deleted.
 */
export function RelationshipRowDelete() {
  const { relationshipId, title, partners } = useLoaderData() as {
    relationshipId: string;
    title: string;
    partners: [Partner, Partner];
  };
  const relPath = `/relationships/${relationshipId}`;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  const [a, b] = partners;

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: title, to: relPath },
          { label: "Remove relationship" },
        ]}
      />
      <h1>Remove relationship?</h1>
      <p>
        Remove the relationship between {a.label} and {b.label}? This removes it
        for both of them, but does not delete either {a.label} or {b.label}.
      </p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button> <Link to={relPath}>Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
