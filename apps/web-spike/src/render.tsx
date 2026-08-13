import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MessagesProvider, en } from "@leapsake/ui/messages";
import { GiftsPortsProvider, UiProvider } from "@leapsake/ui/web";
import { ssrGiftsPorts } from "./gifts-ports-ssr.js";
import { ssrUiAdapter } from "./ui-adapter.js";

/**
 * One server render: the shared UI's three providers, a document around them, and
 * a string.
 *
 * The provider stack is `apps/desktop/src/renderer/src/App.tsx` minus
 * `DropImportProvider` (a drag-and-drop target, meaningless without JavaScript)
 * and minus the search chrome. Three of the four providers port across
 * unchanged, which is the point: they are the shared UI's whole ambient
 * dependency surface, and none of them assumes a browser.
 *
 * **No `<script>` and no hydration.** Increment 2 answers whether the read path
 * works with JavaScript disabled, so shipping any would let a bug hide behind the
 * client bundle repairing it. `renderToString` — not `renderToPipeableStream` —
 * for the same reason: streaming is a performance shape, and the measurement
 * wants one honest number for "the whole page was ready".
 *
 * Increment 4 adds the single exception, and it is the opposite case rather than
 * a weakening of the rule: a **capability link** cannot work without JavaScript,
 * because the key it decrypts with never reaches this server. So `script` is
 * offered to exactly one route (`share-view.tsx`), and every other page keeps the
 * property that a missing `<script>` is checkable evidence rather than a promise.
 */
export function renderPage(opts: {
  title: string;
  children: ReactNode;
  /** A module to load — the capability-link viewer, and nothing else. */
  script?: string;
}): string {
  const body = renderToString(
    <MessagesProvider messages={en}>
      <UiProvider adapter={ssrUiAdapter}>
        <GiftsPortsProvider ports={ssrGiftsPorts}>
          {opts.children}
        </GiftsPortsProvider>
      </UiProvider>
    </MessagesProvider>,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)} — Leapsake web spike</title>
</head>
<body>
${body}
${opts.script === undefined ? "" : `<script type="module" src="${opts.script}"></script>`}
</body>
</html>
`;
}

/** For the title only — everything inside `body` came from React, already escaped. */
function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
