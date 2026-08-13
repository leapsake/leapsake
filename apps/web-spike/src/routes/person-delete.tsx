import type { CoreApi } from "@leapsake/core";
import { fullName } from "@leapsake/schema";
import { ConfirmDelete } from "@leapsake/ui/web";
import { html, redirect, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **D** — delete a person, with JavaScript disabled.
 *
 * `ConfirmDelete` is the shared confirm-before-destroying screen all ten of
 * desktop's delete routes use, and it ports with no wrapper: it renders a
 * `<form method="post">` through the adapter with no `action`, so the confirm
 * posts back to the URL that rendered it. Its `hiddenFields` prop — the second
 * data point the increment wanted on hidden inputs — is not exercised by a
 * person delete, whose whole identity is in the path; the case that needs it is
 * the inferred-relationship dismiss, which has no stored id.
 *
 * The delete is the letter worth being strict about, because "it vanished
 * locally" and "it propagated" are easy to confuse for a tombstone. Under a cold
 * store they cannot be: the request that follows the 303 throws this database
 * away and rebuilds it from the relay, so a person still on the list after a
 * delete means the tombstone did not reach the relay, and a person gone from it
 * means it did.
 */

export async function personDeletePage(
  core: CoreApi,
  id: string,
): Promise<Reply> {
  const view = await core.views.person(id);
  if (view === null) return text(404, "Person not found\n");

  const name = fullName(view.person);
  const personPath = `/people/${id}`;

  return html(
    renderPage({
      title: `Delete ${name}?`,
      children: (
        <ConfirmDelete
          trail={[
            { label: "People & Pets", href: "/people" },
            { label: name, href: personPath },
          ]}
          heading={`Delete ${name}?`}
          confirmLabel="Delete"
          cancelTo={personPath}
          submitting={false}
        >
          Are you sure you want to delete {name}?
        </ConfirmDelete>
      ),
    }),
  );
}

export async function personDeleteSubmit(
  core: CoreApi,
  id: string,
): Promise<Reply> {
  await core.people.softDelete(id);
  return redirect("/people");
}
