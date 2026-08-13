import type { CoreApi } from "@leapsake/core";
import { fullName, tagLabel } from "@leapsake/schema";
import { Breadcrumbs, PersonForm } from "@leapsake/ui/web";
import { readPersonInput, readTags } from "../form-data.js";
import { html, redirect, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **U** — edit a person, with JavaScript disabled.
 *
 * The finding this route exists to make concrete: `PersonForm` is the *same
 * component* create renders, given a `person` and no `candidates`, exactly as
 * desktop shares it between `PersonCreate` and `PersonEdit`. Sharing a form
 * across two routes is the thing a no-JS client is usually assumed to lose,
 * because the form's identity is normally "the thing the JS submits". Here the
 * form's identity is the URL it sits on — `FormShell` emits `<form method="post">`
 * with **no** `action`, so it posts to whatever route rendered it — and the two
 * routes differ only in what they hand it.
 */

export async function personEditPage(
  core: CoreApi,
  id: string,
): Promise<Reply> {
  const view = await core.views.person(id);
  if (view === null) return text(404, "Person not found\n");

  const { person, tags } = view;
  const name = fullName(person);

  return html(
    renderPage({
      title: `Edit ${name}`,
      children: (
        <main>
          <Breadcrumbs
            trail={[
              { label: "People & Pets", href: "/people" },
              { label: name, href: `/people/${person.id}` },
            ]}
          />
          <PersonForm
            title={`Edit ${name}`}
            person={person}
            tagNames={tags.map((tag) => tagLabel(tag.name)).join(" ")}
            search={(query) => core.search.query(query)}
            submitLabel="Save"
            cancelTo={`/people/${person.id}`}
            submitting={false}
          />
        </main>
      ),
    }),
  );
}

export async function personEditSubmit(
  core: CoreApi,
  id: string,
  form: URLSearchParams,
): Promise<Reply> {
  await core.people.update(id, readPersonInput(form), readTags(form));
  return redirect(`/people/${id}`);
}
