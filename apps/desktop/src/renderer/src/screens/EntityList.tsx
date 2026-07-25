import type { EntityRow } from "@leapsake/core";
import { entityBasePath } from "@leapsake/ui/headless";
import {
  Link,
  useFetcher,
  useLoaderData,
  useSearchParams,
} from "react-router-dom";

export type { EntityRow };

/** The list, who "you" are — the loader resolves the self-person alongside the
 *  entities so a row can be badged and the pick-self flow can tick it — and how
 *  many duplicate pairs are outstanding, which decides whether the review link
 *  is offered at all. */
interface EntityListData {
  entities: EntityRow[];
  selfPersonId: string | null;
  duplicateCount: number;
}

/**
 * The combined "People & Pets" home screen. People and pets are minor variations
 * on the same idea, so they share one alphabetical list rather than two parallel
 * screens; each row links to its own view page.
 *
 * `?pick=self` puts the screen in **pick-yourself** mode (reached from the
 * onboarding nudge or the post-import prompt): each Person row offers a "This is
 * me" button that sets the self-person. Pets can't be
 * you, so they show nothing in that mode.
 *
 * The duplicates link is **conditional on there being duplicates**, and states
 * the count. It used to sit here permanently, next to the Add actions, which
 * advertised a chore on a screen with nothing to reconcile — including a fresh
 * install with no people at all. Detection is cheap enough to run in the loader
 * (an in-memory pairwise pass), so the link can simply tell the truth.
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
