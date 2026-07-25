import type { Pet, Tag } from "@leapsake/schema";
import { tagLabel } from "@leapsake/schema";
import { Breadcrumbs } from "@leapsake/ui/web";
import { useLoaderData } from "react-router-dom";
import { PetForm } from "../components/PetForm";
import { homeCrumb } from "../lib/crumbs";

export function PetEdit() {
  const { pet, tags } = useLoaderData() as { pet: Pet; tags: Tag[] };

  return (
    <main>
      <Breadcrumbs
        trail={[homeCrumb, { label: pet.name, href: `/pets/${pet.id}` }]}
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
