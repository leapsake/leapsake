import type { EntityType } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import { entityBasePath } from "../lib/entityLabel";

/** A single combined-list entry: a person or pet reduced to its display label. */
export interface EntityRow {
  type: EntityType;
  id: string;
  label: string;
}

/**
 * The combined "People & Pets" home screen. People and pets are minor variations
 * on the same idea, so they share one alphabetical list rather than two parallel
 * screens; each row links to its own view page.
 */
export function EntityList() {
  const entities = useLoaderData() as EntityRow[];

  return (
    <main>
      <h1>People &amp; Pets</h1>

      <p>
        <Link to="/people/new">Add person</Link>{" "}
        <Link to="/pets/new">Add pet</Link>
      </p>

      {entities.length === 0 ? (
        <p>Nobody here yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((entity) => (
              <tr key={`${entity.type}:${entity.id}`}>
                <td>
                  <Link to={`${entityBasePath(entity.type)}/${entity.id}`}>
                    {entity.label}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
