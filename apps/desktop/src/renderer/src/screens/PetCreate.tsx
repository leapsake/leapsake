import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PetForm } from "../components/PetForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";

export function PetCreate() {
  const candidates = useLoaderData() as RelationshipCandidate[];

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb, { label: "Add pet" }]} />
      <PetForm
        title="Add a pet"
        candidates={candidates}
        submitLabel="Add"
        cancelTo="/"
      />
    </main>
  );
}
