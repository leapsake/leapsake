import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **Increment 5d's page**: the browser client with the server switched off.
 *
 * The three previous increments each removed one thing a reload used to need.
 * 5c gave it a store, a schema and a sync cursor that survive; 5e gave it the
 * master key, so the reload needs neither the password nor the relay. What was
 * still missing is the least interesting and most fatal: **the page itself**.
 * A client whose data is entirely local still shows a browser error page when
 * the network is gone, because the HTML, the module graph and 864 KiB of
 * `.wasm` all come from a server. A manifest and a service worker fix that, and
 * that is the whole of 5d's asset half.
 *
 * What the page adds beyond `/client-key`, all of it in service of a question:
 *
 * - **it resumes by itself.** No button: an installed app that needs a click to
 *   show its data is not the thing being tested. The click is only there when
 *   custody is empty, and then it is a password.
 * - **it reports whether the load touched the network**, from three
 *   independent places — the service worker's own per-client tally, the
 *   browser's resource timing (`transferSize`), and `navigator.onLine`.
 * - **it can be opened twice.** The OPFS pool is one tab at a time, and this is
 *   the page a user installs and then opens again; the worker's leader election
 *   turns 5c's `NoModificationAllowedError` into a queue.
 * - **it asks for durable storage from an installable origin**, which is the
 *   number 5e could not collect: `persist()` was refused on plain `localhost`.
 */
export function clientPwaPage(): Reply {
  return html(
    renderPage({
      title: "The client as an installed app",
      script: "/src/client/client-pwa-app.tsx",
      react: true,
      manifest: true,
      children: (
        <main>
          <h1>The client as an installed app</h1>
          <p>
            Everything below this line came out of this browser.{" "}
            <strong>Load it once with the server up</strong> — logging in if the
            wrap is gone — then stop the dev server (or tick{" "}
            <em>Offline</em> in DevTools) and reload. The page, its modules, the{" "}
            <code>.wasm</code>, the OPFS database and the master key are all
            local by then, so the reload should render the person with nothing
            answering on <code>:5180</code>.
          </p>

          <p id="offline-ready">
            <small>Registering the service worker…</small>
          </p>
          <p id="custody">
            <small>Starting the worker…</small>
          </p>
          <p id="storage">
            <small>Asking for durable storage…</small>
          </p>
          <p id="install-row" hidden>
            <button type="button" id="install">
              Install this app
            </button>{" "}
            <small>
              Chrome only offers this when the manifest, the icons and a service
              worker are all in place — and an installed origin is the one 5e
              could not test <code>persist()</code> from.
            </small>
          </p>

          <form id="login" hidden>
            <p>
              <label htmlFor="username">Username</label>{" "}
              <input
                id="username"
                name="username"
                autoComplete="username"
                defaultValue="ada"
              />
            </p>
            <p>
              <label htmlFor="password">Password</label>{" "}
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                defaultValue="hunter2 hunter2"
              />
            </p>
            <button type="submit" id="go">
              Log in, and mint the wrap this app runs on
            </button>
          </form>

          <div id="stages" />
          <pre id="verdict" style={{ whiteSpace: "pre-wrap" }} />

          <p>
            <button type="button" id="forget">
              Forget the wrap
            </button>{" "}
            <small>The store stays; the next launch wants a password.</small>
            <br />
            <button type="button" id="wipe">
              Wipe the OPFS database and the wrap
            </button>{" "}
            <br />
            <button type="button" id="uncache">
              Empty the service worker&rsquo;s cache
            </button>{" "}
            <small>
              The asset half only — it leaves the store and the key alone, which
              is the difference this increment is about.
            </small>
          </p>

          <div id="app" />

          <noscript>
            <p>
              A progressive web app with JavaScript disabled is a static page,
              so — like <code>/client</code>, <code>/client-worker</code> and{" "}
              <code>/client-key</code> — this one does nothing without it.
            </p>
          </noscript>
        </main>
      ),
    }),
  );
}
