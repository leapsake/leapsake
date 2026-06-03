import type { Person, Tag } from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { fullName } from "../lib/fullName";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function PersonView() {
  const { person, tags } = useLoaderData() as { person: Person; tags: Tag[] };

  return (
    <main>
      <Breadcrumbs trail={[{ label: "People", to: "/" }]} />

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
    </main>
  );
}
