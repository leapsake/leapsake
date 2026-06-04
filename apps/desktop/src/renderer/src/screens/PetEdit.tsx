import type { Pet } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PetForm } from "../components/PetForm";

export function PetEdit() {
  const { pet } = useLoaderData() as { pet: Pet };

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: pet.name, to: `/pets/${pet.id}` }]}
      />
      <PetForm
        title={`Edit ${pet.name}`}
        pet={pet}
        submitLabel="Save"
        cancelTo={`/pets/${pet.id}`}
      />
    </main>
  );
}
