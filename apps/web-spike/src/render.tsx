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
 * because the key it decrypts with never reaches this server. Increment 5a adds
 * the second and last one, which is not a page a user ever sees:
 * `driver-contract.tsx` is a test harness whose subject *is* JavaScript. Every
 * other page keeps the property that a missing `<script>` is checkable evidence
 * rather than a promise.
 */
/**
 * The React Refresh preamble `@vitejs/plugin-react` requires of any **dev-server**
 * page that renders React in the browser.
 *
 * Normally Vite injects this through `transformIndexHtml`, which the spike cannot
 * use: that would also inject `/@vite/client` into *every* page, and "this page
 * contains no `<script>`" is a property Increments 2, 3 and 4 check on the wire.
 * So it is opt-in per page, and exactly one page opts in.
 *
 * Without it the plugin's transform of any React module throws **"can't detect
 * preamble"** at the first component import, which is a runtime error in a
 * *dependency* rather than in the page — the module graph is fine, the build is
 * fine, and the failure names a package the spike never edited. Increment 4's
 * browser bundles never hit it because `vite build` does not use Refresh at all.
 */
const REACT_REFRESH_PREAMBLE = `<script type="module">
import RefreshRuntime from "/@react-refresh";
RefreshRuntime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;
window.__vite_plugin_react_preamble_installed__ = true;
</script>`;

export function renderPage(opts: {
  title: string;
  children: ReactNode;
  /** A module to load — the capability-link viewer, and nothing else. */
  script?: string;
  /** Does {@link renderPage.script} render React? See the preamble above. */
  react?: boolean;
  /**
   * **Increment 5d**: link the web app manifest, which is what makes a page
   * installable. One page opts in, for the same reason one page opts into the
   * Refresh preamble — a `<link rel="manifest">` in the SSR pages would make
   * every no-JS route claim to be part of an app it is not part of.
   */
  manifest?: boolean;
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
${
  opts.manifest === true
    ? `<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#103d3a">
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">`
    : ""
}
${opts.react === true ? REACT_REFRESH_PREAMBLE : ""}
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
