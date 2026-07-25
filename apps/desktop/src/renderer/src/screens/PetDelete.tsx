import type { Pet } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { useSubmitting } from "../lib/useSubmitting";
import { homeCrumb } from "../lib/crumbs";

export function PetDelete() {
  const { pet } = useLoaderData() as { pet: Pet };
  const petPath = `/pets/${pet.id}`;

  return (
    <ConfirmDelete
      trail={[homeCrumb, { label: pet.name, href: petPath }]}
      heading={`Delete ${pet.name}?`}
      confirmLabel="Delete"
      cancelTo={petPath}
      submitting={useSubmitting()}
    >
      Are you sure you want to delete {pet.name}?
    </ConfirmDelete>
  );
}
