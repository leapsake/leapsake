import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { PetForm } from "../components/PetForm";
import type { RelationshipCandidate } from "../components/RelationshipForm";
import { homeCrumb } from "../lib/crumbs";

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
