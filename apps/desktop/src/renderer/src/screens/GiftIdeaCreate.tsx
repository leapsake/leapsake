import { useSearchParams } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GiftIdeaForm } from "../components/GiftIdeaForm";
import { entityBasePath } from "../lib/entityLabel";

/**
 * Add a gift idea. When launched from a recipient's "add a new gift idea for X"
 * link (`?for=<type>:<id>`), the create action also suggests the new idea for
 * that recipient (one transaction) and returns there — so Cancel returns there
 * too. The `<Form>` posts to this same URL, carrying the `for` hint to the action.
 */
export function GiftIdeaCreate() {
  const [params] = useSearchParams();
  const forParam = params.get("for");
  const [type, id] = forParam?.split(":") ?? [];
  const cancelTo =
    (type === "person" || type === "pet") && id
      ? `${entityBasePath(type)}/${id}`
      : "/gifts";

  return (
    <main>
      <Breadcrumbs
        trail={[
          homeCrumb,
          { label: "Gift ideas", to: "/gifts" },
          { label: "Add gift idea" },
        ]}
      />
      <h1>Add gift idea</h1>
      <GiftIdeaForm cancelTo={cancelTo} />
    </main>
  );
}
