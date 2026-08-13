import type { CoreApi } from "@leapsake/core";
import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * Where a create lands when the detector finds a match — a throwaway list, for
 * the same reason `people.tsx` is one.
 *
 * **There is no shared duplicates screen.** Desktop's `screens/Duplicates.tsx`
 * is renderer-local and leans on `useFetcher`, so the spike either writes ten
 * lines of its own or promotes a screen into `@leapsake/ui`, and promoting one
 * is product work wearing a spike's clothes. This route exists so the ported
 * create redirect has somewhere real to land: the alternative is a 404 that
 * would read as the write path failing.
 *
 * The merge and "not the same" actions are deliberately absent. They are more
 * `core` calls behind more POSTs — the same shape Increment 3 has already
 * proved three times — and proving it a fourth answers nothing new.
 */
export async function duplicatesPage(
  core: CoreApi,
  focusId: string | null,
): Promise<Reply> {
  const candidates =
    focusId === null
      ? await core.duplicates.findCandidates()
      : await core.duplicates.findFor(focusId);

  return html(
    renderPage({
      title: "Review duplicates",
      children: (
        <main>
          <p>
            <a href="/people">People &amp; Pets</a>
          </p>
          <h1>
            {focusId === null
              ? "Review duplicates"
              : "Is this someone you already have?"}
          </h1>
          {candidates.length === 0 ? (
            <p>Nothing else looks like the same person.</p>
          ) : (
            <ul>
              {candidates.map((pair) => (
                <li key={`${pair.a.id}:${pair.b.id}`}>
                  <a href={`/people/${pair.a.id}`}>{pair.a.name}</a>
                  {" / "}
                  <a href={`/people/${pair.b.id}`}>{pair.b.name}</a> — {pair.tier}
                  {pair.reasons.length > 0 && ` (${pair.reasons.join(", ")})`}
                </li>
              ))}
            </ul>
          )}
          {focusId !== null && (
            <p>
              <a href={`/people/${focusId}`}>Continue</a>
            </p>
          )}
        </main>
      ),
    }),
  );
}
