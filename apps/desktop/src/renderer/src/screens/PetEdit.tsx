import type { Pet, Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { PetForm } from "../components/PetForm";

export function PetEdit() {
  const { pet, tags } = useLoaderData() as { pet: Pet; tags: Tag[] };

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: pet.name, to: `/pets/${pet.id}` }]}
      />
      <PetForm
        title={`Edit ${pet.name}`}
        pet={pet}
        tagNames={tags.map((tag) => tagLabel(tag.name)).join(" ")}
        submitLabel="Save"
        cancelTo={`/pets/${pet.id}`}
      />
    </main>
  );
}
