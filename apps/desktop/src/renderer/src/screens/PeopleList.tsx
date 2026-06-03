import type { Person } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { fullName } from "../lib/fullName";

export function PeopleList() {
  const people = useLoaderData() as Person[];

  return (
    <main>
      <h1>People</h1>

      <p>
        <Link to="/people/new">Add person</Link>
      </p>

      {people.length === 0 ? (
        <p>No people yet.</p>
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
