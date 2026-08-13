import { MessagesProvider, en } from "@leapsake/ui/messages";
import { RelationshipScreen, UiProvider } from "@leapsake/ui/web";
import { createRoot } from "react-dom/client";
import { ssrUiAdapter } from "../ui-adapter.js";
import { decodeShare } from "./share.js";

/**
 * **A build probe, not a route.** Nothing loads this; `scripts/share.ts` builds
 * it to answer one question for the price of ten lines — *does `@leapsake/ui`
 * compile to a browser target, and what does it weigh?*
 *
 * That is Increment 5's second-biggest assumption after sqlite-wasm, and the
 * cheapest possible moment to find out it is wrong is now, while a bundler is
 * already being pointed at the shared crypto for `share.ts`. If it builds, the
 * client-side render path is plumbing; if it does not, that is a precise answer
 * arriving four increments early.
 *
 * The capability viewer the spike actually ships stays plain-DOM (`share.ts`
 * says why), so this file exists purely to be weighed and then deleted with the
 * rest of the app.
 */
const host = document.getElementById("share");
if (host !== null) {
  const payload = decodeShare(
    host.getAttribute("data-blob") ?? "",
    location.hash,
  );
  createRoot(host).render(
    <MessagesProvider messages={en}>
      <UiProvider adapter={ssrUiAdapter}>
        <RelationshipScreen
          trail={[{ label: "Shared with you" }]}
          relationshipId={payload.relationshipId}
          title={payload.title}
          partners={payload.partners}
          milestones={payload.milestones}
        />
      </UiProvider>
    </MessagesProvider>,
  );
}
