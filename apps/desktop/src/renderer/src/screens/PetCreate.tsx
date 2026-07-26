import {
  Breadcrumbs,
  PetForm,
  type RelationshipCandidate,
} from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../lib/crumbs";
import { useSubmitting } from "../lib/useSubmitting";

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
        submitting={useSubmitting()}
      />
    </main>
  );
}
