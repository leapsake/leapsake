import type { CoreApi } from "@leapsake/core";
import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * The list of people and pets — a bare `<ul>` of `<a href>`, written here rather
 * than reused.
 *
 * **There is no shared people-list screen.** It lives only in the desktop
 * renderer, so the spike either builds a throwaway list or builds a shared one,
 * and building a shared one is product work wearing a spike's clothes. The
 * `views.entityList()` builder underneath *is* shared, which is the part that
 * matters: the merge-and-sort of people with pets is core's, not a client's.
 *
 * Pets render as plain rows. `PetScreen` is shared and a pet route would be a
 * near-copy of `person.tsx`, but the spike's question is answered once by the
 * richest screen, and answering it twice buys nothing.
 */
export async function peoplePage(core: CoreApi, username: string): Promise<Reply> {
  const rows = await core.views.entityList();

  return html(
    renderPage({
      title: "People & Pets",
      children: (
        <main>
          <header>
            <h1>People &amp; Pets</h1>
            <form method="post" action="/logout">
              <small>
                Signed in as {username}. <button type="submit">Log out</button>
              </small>
            </form>
          </header>
          <ul>
            {rows.map((row) => (
              <li key={`${row.type}:${row.id}`}>
                {row.type === "person" ? (
                  <a href={`/people/${row.id}`}>{row.label}</a>
                ) : (
                  <span>{row.label} (pet)</span>
                )}
              </li>
            ))}
          </ul>
          <p>
            <small>{rows.length} entries</small>
          </p>
        </main>
      ),
    }),
  );
}
