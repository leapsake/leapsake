import type { EntityRow } from "@leapsake/core";
import { entityBasePath } from "@leapsake/ui/headless";
import {
  Link,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "react-router-dom";

export type { EntityRow };

/** The list, the self-person's id, and the outstanding duplicate count. */
interface EntityListData {
  entities: EntityRow[];
  selfPersonId: string | null;
  duplicateCount: number;
}

/**
 * People and pets in one alphabetical list. `?pick=self` adds "This is me" to
 * each person; the duplicates link shows only when there are pairs.
 */
export function EntityList() {
  const { entities, selfPersonId, duplicateCount } =
    useLoaderData() as EntityListData;
  const [params] = useSearchParams();
  const picking = params.get("pick") === "self";
  const fetcher = useFetcher();

  return (
    <main>
      <h1>People &amp; Pets</h1>

      {picking ? (
        <p>Which of these is you? Pick yourself from the list.</p>
      ) : (
        <p>
          <Link to="/people/new">Add person</Link>{" "}
          <Link to="/pets/new">Add pet</Link>
          {duplicateCount > 0 && (
            <>
              {" "}
              <Link to="/duplicates">
                Review {duplicateCount} possible{" "}
                {duplicateCount === 1 ? "duplicate" : "duplicates"}
              </Link>
            </>
          )}
        </p>
      )}

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
            {entities.map((entity) => {
              const isSelf =
                entity.type === "person" && entity.id === selfPersonId;
              return (
                <tr key={`${entity.type}:${entity.id}`}>
                  <td>
                    <Link to={`${entityBasePath(entity.type)}/${entity.id}`}>
                      {entity.label}
                    </Link>{" "}
                    {isSelf && <small style={{ color: "#666" }}>(You)</small>}
                    {/* Pick-yourself: only a Person can be you, and there's no
                        point offering it on the row that's already you. */}
                    {picking && entity.type === "person" && !isSelf && (
                      <fetcher.Form
                        method="post"
                        action="/people"
                        style={{ display: "inline" }}
                      >
                        <input
                          type="hidden"
                          name="personId"
                          value={entity.id}
                        />
                        <button type="submit">This is me</button>
                      </fetcher.Form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
