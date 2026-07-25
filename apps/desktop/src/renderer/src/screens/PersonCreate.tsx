import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { PersonForm } from "../components/PersonForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { homeCrumb } from "../lib/crumbs";

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
