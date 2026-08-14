import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **Increment 5a's page**: a shell, and the script that answers the question.
 *
 * Everything of substance is in `src/client/driver-contract.ts`, which runs the
 * shared `runDriverContract` against `@sqlite.org/sqlite-wasm` in the browser and
 * writes its verdict into `#contract`. This route exists only to be the document
 * that loads it.
 *
 * Unauthenticated and session-free on purpose: a driver test needs no account, no
 * relay and no key, so a red result here can only mean the browser data layer,
 * which is the whole point of stopping at 5a before 5b commits to a login.
 *
 * The `<noscript>` is not decoration — this is the one page in the spike whose
 * subject *is* JavaScript, so the no-JS floor does not apply to it and saying that
 * out loud keeps Increment 2's "no page is silently broken" property intact.
 */
export function driverContractPage(): Reply {
  return html(
    renderPage({
      title: "Driver contract",
      script: "/src/client/driver-contract.ts",
      children: (
        <main>
          <h1>SqliteDriver contract — in a browser</h1>
          <p>
            <code>runDriverContract</code> from <code>@leapsake/data/testing</code>
            , the same spec desktop runs in Vitest and mobile runs on a simulator,
            against <code>@sqlite.org/sqlite-wasm</code>.
          </p>
          <div id="contract">Running…</div>
          <noscript>
            <p>
              This page is a JavaScript test harness, so it is the one page here
              that cannot report anything without JavaScript.
            </p>
          </noscript>
        </main>
      ),
    }),
  );
}
