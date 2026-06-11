import type { Person, Pet, Tag } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { fullName } from "../lib/fullName";
import { tagLabel } from "../lib/tagLabel";

/** One row in a tag's grouped listing: a labelled link to an entity's page. */
function EntityRows({
  rows,
}: {
  rows: { id: string; label: string; to: string }[];
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td>
              <Link to={row.to}>{row.label}</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Everything carrying a given tag, grouped by entity type. People and Pets are
 * both taggable; each group renders only when it has members, and an empty tag
 * shows a placeholder.
 */
export function TagView() {
  const { tag, people, pets } = useLoaderData() as {
    tag: Tag;
    people: Person[];
    pets: Pet[];
  };

  const empty = people.length === 0 && pets.length === 0;

  return (
    <main>
      <Breadcrumbs
        trail={[{ label: "Home", to: "/" }, { label: tagLabel(tag.name) }]}
      />

      <header>
        <h1>Tagged {tagLabel(tag.name)}</h1>
        <Link to={`/tags/${tag.id}/delete`}>Delete tag</Link>
      </header>

      {empty && <p>Nothing has this tag.</p>}

      {people.length > 0 && (
        <>
          <h2>People</h2>
          <EntityRows
            rows={people.map((person) => ({
              id: person.id,
              label: fullName(person),
              to: `/people/${person.id}`,
            }))}
          />
        </>
      )}

      {pets.length > 0 && (
        <>
          <h2>Pets</h2>
          <EntityRows
            rows={pets.map((pet) => ({
              id: pet.id,
              label: pet.name,
              to: `/pets/${pet.id}`,
            }))}
          />
        </>
      )}
    </main>
  );
}
