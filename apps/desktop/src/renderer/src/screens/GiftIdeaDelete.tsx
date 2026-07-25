import type { GiftIdea } from "@leapsake/schema";
import { Form, Link, useLoaderData, useNavigation } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";

export function GiftIdeaDelete() {
  const idea = useLoaderData() as GiftIdea;
  const navigation = useNavigation();
  const deleting = navigation.state === "submitting";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gifts", to: "/gifts" },
          { label: "Remove gift idea" },
        ]}
      />
      <h1>Remove gift idea?</h1>
      <p>Remove “{idea.title}”?</p>

      <Form method="post">
        <fieldset disabled={deleting}>
          <button type="submit">Remove</button> <Link to="/gifts">Cancel</Link>
        </fieldset>
      </Form>
    </main>
  );
}
