import type { Pet } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { homeCrumb } from "../components/Breadcrumbs";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { useSubmitting } from "../lib/useSubmitting";

export function PetDelete() {
  const { pet } = useLoaderData() as { pet: Pet };
  const petPath = `/pets/${pet.id}`;

  return (
    <ConfirmDelete
      trail={[homeCrumb, { label: pet.name, to: petPath }]}
      heading={`Delete ${pet.name}?`}
      confirmLabel="Delete"
      cancelTo={petPath}
      submitting={useSubmitting()}
    >
      Are you sure you want to delete {pet.name}?
    </ConfirmDelete>
  );
}
