import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PersonForm } from "../components/PersonForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";

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
      />
    </main>
  );
}
