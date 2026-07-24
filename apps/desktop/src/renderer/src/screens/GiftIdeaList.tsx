import type { GiftIdea } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";

/**
 * The Gifts screen — a standalone list of gift ideas (things in the world),
 * newest first. Useful on its own as an idea / shopping list; suggestions (idea ×
 * recipient) and givings hang off these ideas in later slices. Each row links its
 * title to its edit page, shows its link and notes, and offers Remove.
 */
export function GiftIdeaList() {
  const ideas = useLoaderData() as GiftIdea[];

  return (
    <main>
      <h1>Gift ideas</h1>

      <p>
        <Link to="/gifts/new">Add gift idea</Link>
      </p>

      {ideas.length === 0 ? (
        <p>No gift ideas yet.</p>
      ) : (
        <ul>
          {ideas.map((idea) => (
            <li key={idea.id}>
              <Link to={`/gifts/${idea.id}/edit`}>{idea.title}</Link>{" "}
              {idea.url !== null && (
                <>
                  <a href={idea.url} target="_blank" rel="noreferrer">
                    link
                  </a>{" "}
                </>
              )}
              <Link to={`/gifts/${idea.id}/delete`}>Remove</Link>
              {idea.notes !== null && (
                <div>
                  <small style={{ color: "#666" }}>{idea.notes}</small>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
