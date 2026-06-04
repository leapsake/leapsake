import type { Pet, RelationshipNeighbor } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { RelationshipsSection } from "../components/RelationshipsSection";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PetView() {
  const { pet, relationships } = useLoaderData() as {
    pet: Pet;
    relationships: RelationshipNeighbor[];
  };

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{pet.name}</h1>
        <Link to={`/pets/${pet.id}/edit`}>Edit</Link>{" "}
        <Link to={`/pets/${pet.id}/delete`}>Delete</Link>
      </header>

      <dl>
        <dt>Name</dt>
        <dd>{pet.name}</dd>
        <dt>Created</dt>
        <dd>{formatTimestamp(pet.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(pet.updatedAt)}</dd>
      </dl>

      <RelationshipsSection
        subjectType="pet"
        subjectId={pet.id}
        relationships={relationships}
      />
    </main>
  );
}
