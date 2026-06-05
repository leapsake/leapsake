import type { Person, RelationshipNeighbor, Tag } from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs, homeCrumb } from "../components/Breadcrumbs";
import { GenderValue, type GenderResult } from "../components/GenderValue";
import { RelationshipsSection } from "../components/RelationshipsSection";
import { fullName } from "../lib/fullName";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PersonView() {
  const { person, tags, relationships, gender } = useLoaderData() as {
    person: Person;
    tags: Tag[];
    relationships: RelationshipNeighbor[];
    gender: GenderResult;
  };

  return (
    <main>
      <Breadcrumbs trail={[homeCrumb]} />

      <header>
        <h1>{fullName(person)}</h1>
        <Link to={`/people/${person.id}/edit`}>Edit</Link>{" "}
        <Link to={`/people/${person.id}/delete`}>Delete</Link>
      </header>

      <dl>
        <dt>First name</dt>
        <dd>{person.firstName}</dd>
        <dt>Middle name</dt>
        <dd>{person.middleName ?? "—"}</dd>
        <dt>Last name</dt>
        <dd>{person.lastName}</dd>
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
        <dd>{formatTimestamp(person.createdAt)}</dd>
        <dt>Updated</dt>
        <dd>{formatTimestamp(person.updatedAt)}</dd>
      </dl>

      <RelationshipsSection
        subjectType="person"
        subjectId={person.id}
        relationships={relationships}
      />
    </main>
  );
}
