import type { CoreApi } from "@leapsake/core";
import { Breadcrumbs, PersonForm } from "@leapsake/ui/web";
import {
  createRelationships,
  readPersonInput,
  readRelationships,
  readTags,
} from "../form-data.js";
import { html, redirect, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **C** — create a person, with JavaScript disabled.
 *
 * The GET is `screens/PersonCreate.tsx` with `useLoaderData()` replaced by an
 * argument and `useSubmitting()` — a react-router hook, and therefore the one
 * thing on the screen that genuinely cannot port — replaced by `false`. A no-JS
 * form has no in-flight state to render: the browser owns the submission, and
 * the next thing the user sees is the next page.
 *
 * The POST is the desktop router's `people/new` action (`router.tsx:1156`) call
 * for call, redirect rule included.
 */

/** `PersonForm` requires a `search` prop; SSR is where it can never be called. */
function ssrSearch(core: CoreApi) {
  // Wired to the real thing rather than stubbed, because it is one line and a
  // stub would be a claim. `ChipTextField`'s picker runs off `onChange`, so with
  // no JavaScript nothing ever calls this — but with JavaScript it is correct,
  // which is the property Increment 5 will want.
  return (query: string) => core.search.query(query);
}

export async function personNewPage(core: CoreApi): Promise<Reply> {
  const candidates = await core.views.candidates();

  return html(
    renderPage({
      title: "Add a person",
      children: (
        <main>
          <Breadcrumbs
            trail={[
              { label: "People & Pets", href: "/people" },
              { label: "Add person" },
            ]}
          />
          <PersonForm
            title="Add a person"
            candidates={candidates}
            search={ssrSearch(core)}
            submitLabel="Add"
            cancelTo="/people"
            submitting={false}
          />
        </main>
      ),
    }),
  );
}

export async function personNewSubmit(
  core: CoreApi,
  form: URLSearchParams,
): Promise<Reply> {
  const person = await core.people.create(
    readPersonInput(form),
    readTags(form),
  );
  await createRelationships(core, "person", person.id, readRelationships(form));

  // Ported deliberately, including its cost. `duplicates.findFor` is the
  // quadratic call Increment 2 measured (11.8 s at 10 000 people), and running
  // it here means a *create* pays it too — on top of the create's own
  // `regenerateSystem`. Not fixed here: it is a shared-app defect, desktop makes
  // the same call on the same flow, and the spike's job is to price it.
  const matches = await core.duplicates.findFor(person.id);
  return redirect(
    matches.length > 0 ? `/duplicates?for=${person.id}` : `/people/${person.id}`,
  );
}
