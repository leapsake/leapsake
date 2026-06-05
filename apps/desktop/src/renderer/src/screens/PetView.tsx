import type { Pet, RelationshipNeighbor, Tag } from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GenderValue, type GenderResult } from "../components/GenderValue";
import { RelationshipsSection } from "../components/RelationshipsSection";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PetView() {
  const { pet, tags, relationships, gender } = useLoaderData() as {
    pet: Pet;
    tags: Tag[];
    relationships: RelationshipNeighbor[];
    gender: GenderResult;
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
        <dt>Gender</dt>
        <dd>
          <GenderValue gender={gender} />
        </dd>
        <dt>Tags</dt>
        <dd>
          {tags.length === 0
            ? "—"
            : tags.map((tag, index) => (
                <Fragment key={tag.id}>
                  {index > 0 && ", "}
                  <Link to={`/tags/${tag.id}`}>{tag.name}</Link>
                </Fragment>
              ))}
        </dd>
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
