import type { CoreApi } from "@leapsake/core";
import { Breadcrumbs } from "@leapsake/ui/web";
import { html, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";
import { createShare, type ShareFlavor } from "../shares.js";

/**
 * **Make a share — the two flavors offered side by side**, which is the
 * increment's actual question. §11 says capability links are the default and
 * hosted links an explicit opt-in; this page is what "explicit" looks like when
 * the sharer has to press one of two buttons.
 *
 * A relationship is the thing shared (see `shares.ts` for why), so picking one is
 * two navigations with no JavaScript: choose a person with a `GET` form, then
 * press a flavor on one of their relationships. The pair of submit buttons in one
 * `<form>` — same `name`, different `value` — is the plain-HTML way to offer two
 * actions on one row, and it needed nothing from the shared UI.
 *
 * ## The POST answers with a page instead of redirecting, and that is a finding
 *
 * Every other write in the spike 303s (`reply.ts` explains why). This one cannot,
 * and the reason is structural rather than lazy: a capability link's key exists
 * in this process only for the duration of this request, and the redirect target
 * would have to carry it in a fragment that the server it redirects to will never
 * see. So the create *response* is the only place the key can ever appear, and
 * the consequence is a product rule, not an implementation detail: **a capability
 * link cannot be re-shown.** Lose it and you re-share. A hosted link has no such
 * rule, because the server kept the key.
 *
 * What that costs here is a refresh hazard — re-posting mints a second share of
 * the same relationship. Real; left alone, because the alternative (a one-shot
 * server-side "flash" holding a plaintext key across requests) is precisely the
 * thing the flavor exists to avoid.
 */

export async function shareNewPage(
  core: CoreApi,
  personId: string | null,
): Promise<Reply> {
  const rows = await core.views.entityList();
  const people = rows.filter((row) => row.type === "person");
  const selected = personId ?? people[0]?.id ?? null;

  // `relationships.listForEntity` is the same oriented-neighbor call the person
  // page makes; there is no "list every relationship" on `CoreApi`, and adding
  // one to core would be the spike editing `packages/` for its own convenience.
  const neighbors =
    selected === null
      ? []
      : await core.relationships.listForEntity("person", selected);

  return html(
    renderPage({
      title: "Share a relationship",
      children: (
        <main>
          <Breadcrumbs
            trail={[
              { label: "People & Pets", href: "/people" },
              { label: "Share" },
            ]}
          />
          <h1>Share a relationship</h1>

          <form method="get" action="/share/new">
            <label htmlFor="person">Whose relationships?</label>{" "}
            <select id="person" name="person" defaultValue={selected ?? ""}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>{" "}
            <button type="submit">Show</button>
          </form>

          {neighbors.length === 0 ? (
            <p>No relationships to share.</p>
          ) : (
            <ul>
              {neighbors.map((neighbor) => (
                <li key={neighbor.relationshipId}>
                  {neighbor.otherRoleLabel}: {neighbor.otherLabel}{" "}
                  <form method="post" action="/share/new">
                    <input
                      type="hidden"
                      name="relationship"
                      value={neighbor.relationshipId}
                    />
                    {/* Two submits, one name, two values — the no-JS way to put
                        two actions on one row. */}
                    <button type="submit" name="flavor" value="capability">
                      Capability link (private)
                    </button>{" "}
                    <button type="submit" name="flavor" value="hosted">
                      Hosted link (server can read it)
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </main>
      ),
    }),
  );
}

export async function shareNewSubmit(
  core: CoreApi,
  form: URLSearchParams,
  origin: string,
): Promise<Reply> {
  const relationshipId = form.get("relationship") ?? "";
  const flavor: ShareFlavor =
    form.get("flavor") === "hosted" ? "hosted" : "capability";

  const view = await core.views.relationship(relationshipId);
  if (view === null) return text(404, "Relationship not found\n");

  // `views.relationship` returns exactly `RelationshipScreen`'s props, so the
  // payload is the view model with nothing added and nothing reshaped — no share
  // format to design, because the shared view-model layer already is one. That
  // it type-checks against `@leapsake/ui`'s `RelationshipPartner` without a map
  // is the same property Increment 2 found in the loader.
  const { id, keyFragment } = createShare(flavor, {
    relationshipId: view.relationship.id,
    title: view.title,
    partners: view.partners,
    milestones: view.milestones,
  });

  const link =
    flavor === "capability"
      ? `${origin}/share/${id}#${keyFragment}`
      : `${origin}/hosted/${id}`;

  console.log(
    `share  created ${flavor} ${id}  ` +
      `(server holds the key: ${flavor === "hosted" ? "yes" : "no"})`,
  );

  return html(
    renderPage({
      title: "Share created",
      children: (
        <main>
          <Breadcrumbs
            trail={[
              { label: "People & Pets", href: "/people" },
              { label: "Share", href: "/share/new" },
              { label: "Created" },
            ]}
          />
          <h1>{flavor === "capability" ? "Capability link" : "Hosted link"}</h1>
          <p>
            <code>{link}</code>
          </p>
          {flavor === "capability" ? (
            <>
              <p>
                Everything after the <code>#</code> is the key. Browsers never
                send it, so this server cannot read what it is storing — and{" "}
                <strong>this is the only time the key is shown</strong>: it is
                not stored anywhere.
              </p>
              <p>
                The viewer needs JavaScript. That is not a limitation of this
                page — the key never reaches the server, so no server can render
                it.
              </p>
            </>
          ) : (
            <p>
              The server keeps this share&rsquo;s key, so it renders the content
              itself and works with JavaScript disabled, in link previews, and in
              search results. The trade is that the server can read it.
            </p>
          )}
          <p>
            <a href="/share/new">Share something else</a>
          </p>
        </main>
      ),
    }),
  );
}
