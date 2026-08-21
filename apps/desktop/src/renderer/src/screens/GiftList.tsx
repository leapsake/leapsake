import type { GiftIdeaOverview } from "@leapsake/core";
import { tagLabel } from "@leapsake/schema";
import { isGiven, sortIdeasGivenLast } from "@leapsake/view-models";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";

/**
 * The Gifts screen — the whole gift graph keyed by idea. Each idea shows everyone
 * it is for, ticked or not. Creating is its own screen (the "Add a gift" link),
 * so this stays a plain list — the People & Pets pattern.
 */
export function GiftList() {
  const loaded = useLoaderData() as GiftIdeaOverview[];
  // An idea everyone on it already has sinks to the bottom, keeping the shopping
  // list on top.
  const overview = sortIdeasGivenLast(loaded);

  return (
    <main>
      <h1>Gifts</h1>

      <p>
        <Link to="/gifts/new">Add a gift</Link>
      </p>

      {overview.length === 0 ? (
        <p>No gifts yet.</p>
      ) : (
        <ul>
          {overview.map(({ idea, tags, recipients }) => (
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
              {tags.length > 0 && (
                <div>
                  <small>
                    {tags.map((tag, index) => (
                      <Fragment key={tag.id}>
                        {index > 0 && ", "}
                        <Link to={`/tags/${tag.id}`}>{tagLabel(tag.name)}</Link>
                      </Fragment>
                    ))}
                  </small>
                </div>
              )}
              {idea.notes !== null && (
                <div>
                  <small style={{ color: "#666" }}>{idea.notes}</small>
                </div>
              )}
              {recipients.length > 0 && (
                <ul>
                  {recipients.map((row) => (
                    <li key={row.id}>
                      {isGiven(row) ? "✓ Given to" : "For"} {row.recipientLabel}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
