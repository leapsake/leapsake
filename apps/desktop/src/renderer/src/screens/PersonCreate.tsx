import {
  Breadcrumbs,
  PersonForm,
  type RelationshipCandidate,
} from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

export function PersonCreate() {
  const candidates = useLoaderData() as RelationshipCandidate[];

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb, { label: "Add person" }]} />
      <PersonForm
        title="Add a person"
        candidates={candidates}
        submitLabel="Add"
        cancelTo="/"
        submitting={useSubmitting()}
      />
    </main>
  );
}
