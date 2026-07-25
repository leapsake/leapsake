import type { GiftIdea } from "@leapsake/schema";
import { Link, useLoaderData } from "react-router-dom";
import {
  GiftCaptureForm,
  type PartyOption,
} from "../components/GiftCaptureForm";

/**
 * The Gifts screen — a standalone list of gift ideas (things in the world),
 * newest first. The consolidated capture form on top (plans/gifts.md): typing a
 * name/URL captures an **idea**; adding people/pets makes it **suggestions**;
 * adding dates makes it **givings**. Each row links its title to its edit page
 * (where its recipients live), shows its link and notes, and offers Remove.
 */
export function GiftIdeaList() {
  const { ideas, candidates } = useLoaderData() as {
    ideas: GiftIdea[];
    candidates: PartyOption[];
  };

  return (
    <main>
      <h1>Gift ideas</h1>

      <GiftCaptureForm ideaPool={ideas} recipientCandidates={candidates} />

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
