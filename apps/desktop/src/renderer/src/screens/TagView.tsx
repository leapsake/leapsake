import type { Person, Tag } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { fullName } from "../lib/fullName";

/**
 * Everything carrying a given tag. People are the only taggable entity today, so
 * the page lists them directly; as new entity types gain tags this grows into a
 * grouped listing.
 */
export function TagView() {
  const { tag, people } = useLoaderData() as { tag: Tag; people: Person[] };

  return (
    <main>
      <Breadcrumbs
        trail={[{ label: "People", to: "/" }, { label: tag.name }]}
      />

      <h1>Tagged "{tag.name}"</h1>

      {people.length === 0 ? (
        <p>Nothing has this tag.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link to={`/people/${person.id}`}>{fullName(person)}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
