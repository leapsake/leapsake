import { RelationshipScreen } from "@leapsake/ui/web";
import { html, text, type Reply } from "../reply.js";
import { renderPage } from "../render.js";
import { getShare, openHostedShare } from "../shares.js";

/**
 * **The hosted link's page — ten lines, and every one of them the opposite of
 * `share-view.tsx`.** The server holds the key, so it decrypts and renders, and
 * the result is an ordinary SSR page: no script, works with JavaScript disabled,
 * previewable, indexable. §11's second flavor, and the whole cost of it is the
 * `openHostedShare` call.
 *
 * ## The shared screen renders unauthenticated, and it renders too much
 *
 * The spike doc's optional quarter-hour was whether a shared screen is reusable
 * in an unauthenticated context. `RelationshipScreen` is: zero callback props,
 * no forms, and the payload is its props verbatim (`shares.ts`). Rendering it
 * here took one JSX element.
 *
 * But it renders **"Edit roles", "Delete", and an add-milestone link**, because
 * a screen that has only ever been used by its owner has no reason to know it is
 * being shown to a stranger. With no JavaScript they are plain `<a href>`s to
 * routes this host does not serve, so they 404 rather than doing damage — and
 * they still leak the relationship's internal id and the shape of the owner's
 * app. The verdict matches the two `packages/` entries Increments 2 and 3 logged:
 * plausible and small (a `readOnly` prop, or a viewer-capability context the
 * sections read), but it is **product work** about what a shared view *is*, not a
 * spike's call. Recorded in `WANTED-CHANGES.md`.
 */
export function hostedViewPage(id: string): Reply {
  const record = getShare(id);
  if (record === undefined || record.flavor !== "hosted") {
    return text(404, "No such share\n");
  }

  const payload = openHostedShare(record);
  console.log(
    `hosted GET /hosted/${id}  → decrypted server-side, ` +
      `${payload.partners.length} partners, ${payload.milestones.length} milestones`,
  );

  return html(
    renderPage({
      title: payload.title,
      children: (
        <RelationshipScreen
          trail={[{ label: "Shared with you" }]}
          relationshipId={payload.relationshipId}
          title={payload.title}
          partners={payload.partners}
          milestones={payload.milestones}
        />
      ),
    }),
  );
}
