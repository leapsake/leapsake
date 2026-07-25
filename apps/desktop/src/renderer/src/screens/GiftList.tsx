import type { GiftIdeaOverview } from "@leapsake/core";
import {
  formatGiftDate,
  formatGiftTargetDate,
  tagLabel,
} from "@leapsake/schema";
import { Fragment } from "react";
import { Link, useLoaderData } from "react-router-dom";

const joinBits = (bits: (string | null)[]) => bits.filter(Boolean).join(", ");

/**
 * The Gifts screen — the whole gift graph keyed by idea. Each idea shows who it's
 * **suggested** for and every **giving** of it. Creating is its own screen (the
 * "Add a gift" link), so this stays a plain list — the People & Pets pattern.
 */
export function GiftList() {
  const loaded = useLoaderData() as GiftIdeaOverview[];
  // Ideas already given sink to the bottom, keeping the shopping list on top —
  // the same posture the Person/Pet Gifts section takes (plans/gifts.md: "sort
  // given ones down"). Nothing is hidden: an idea given once is still a fine
  // idea to give again, and filtering would strand it. Within each half the
  // repo's newest-first order stands.
  const overview = [...loaded].sort(
    (a, b) => (a.gifts.length > 0 ? 1 : 0) - (b.gifts.length > 0 ? 1 : 0),
  );

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
          {overview.map(({ idea, tags, suggestions, gifts }) => (
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
              {(suggestions.length > 0 || gifts.length > 0) && (
                <ul>
                  {suggestions.map((s) => {
                    const target = formatGiftTargetDate(s);
                    const bits = joinBits([
                      s.occasionLabel,
                      target === "" ? null : target,
                    ]);
                    return (
                      <li key={s.id}>
                        Suggested for {s.recipientLabel}
                        {bits === "" ? "" : ` — ${bits}`}
                      </li>
                    );
                  })}
                  {gifts.map((g) => {
                    const when = formatGiftDate(g);
                    const bits = joinBits([
                      when === "" ? null : when,
                      g.giverLabel !== null ? `from ${g.giverLabel}` : null,
                      g.occasionLabel,
                    ]);
                    return (
                      <li key={g.id}>
                        ✓ Given to {g.recipientLabel}
                        {bits === "" ? "" : ` — ${bits}`}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
