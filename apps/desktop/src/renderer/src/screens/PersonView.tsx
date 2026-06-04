import type { Person, RelationshipNeighbor, Tag } from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { fullName } from "../lib/fullName";

/** Render an epoch-ms timestamp in the user's locale. */
function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** Path to an entity's view page (only people exist today; pets join later). */
function entityPath(neighbor: RelationshipNeighbor): string {
  return neighbor.otherType === "pet"
    ? `/pets/${neighbor.otherId}`
    : `/people/${neighbor.otherId}`;
}

export function PersonView() {
  const { person, tags, relationships } = useLoaderData() as {
    person: Person;
    tags: Tag[];
    relationships: RelationshipNeighbor[];
  };

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

      <section>
        <header>
          <h2>Relationships</h2>
          <Link to={`/people/${person.id}/relationships/new`}>
            Add relationship
          </Link>
        </header>
        {relationships.length === 0 ? (
          <p>No relationships yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {relationships.map((neighbor) => (
                <tr key={neighbor.relationshipId}>
                  <td>
                    <Link to={entityPath(neighbor)}>{neighbor.otherLabel}</Link>
                  </td>
                  <td>
                    {neighbor.otherRole === "other" && neighbor.otherRoleNote
                      ? neighbor.otherRoleNote
                      : neighbor.otherRoleLabel}
                  </td>
                  <td>
                    <Link
                      to={`/people/${person.id}/relationships/${neighbor.relationshipId}/delete`}
                    >
                      Remove
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
