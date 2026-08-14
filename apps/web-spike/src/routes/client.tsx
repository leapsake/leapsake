import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **Increment 5b's page**: the shell for a client that logs in, pulls and
 * decrypts *in the browser*, and renders a person from the result.
 *
 * The server's job here ends at this markup. It reads no cookie, opens no
 * session, and touches neither key nor store — the difference from every other
 * page in the spike is total, and it is the point: `/people/<id>` is the SSR
 * host holding a decrypted store for the duration of a request, and `/client` is
 * the same screen with the server holding nothing at all. The only thing this
 * origin does for the client afterwards is forward `/relay/*` (`relay-proxy.ts`,
 * which explains why that forwarder is a spike affordance rather than an
 * answer).
 *
 * The form is server-rendered rather than built by the script so that the first
 * paint is a usable login rather than a spinner — and so the fields exist before
 * `sqlite3InitModule()`'s 864 KiB of `.wasm` has finished compiling.
 *
 * Like `driver-contract.tsx`, this page's subject **is** JavaScript, so the
 * spike's no-JS floor does not apply to it and the `<noscript>` says so rather
 * than letting the page look broken. Those two are the only such pages; every
 * other one still carries a missing `<script>` as checkable evidence.
 */
export function clientPage(): Reply {
  return html(
    renderPage({
      title: "Client-side login",
      script: "/src/client/client-app.tsx",
      // The one page in the spike that renders React *in the browser*, so the
      // one page that needs the plugin's Refresh preamble — `render.tsx` says
      // why it cannot simply be on for everything.
      react: true,
      children: (
        <main>
          <h1>Client-side login, pull and decrypt</h1>
          <p>
            Username and password go to <code>@leapsake/crypto</code> in this
            tab. The relay hands back <code>wrap(MK, kek)</code> and a log of
            ciphertext; the master key, the decrypted rows and the SQLite
            database all stay in the browser. <strong>The server renders none of
            it</strong> — it only forwards <code>/relay/*</code>.
          </p>
          <form id="login">
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
              Log in, pull, decrypt, render
            </button>{" "}
            <small>
              Prefilled with the seeded fixture from the README&rsquo;s{" "}
              <em>Run it</em>.
            </small>
          </form>
          <div id="stages" />
          <div id="app" />
          <noscript>
            <p>
              This page is the JavaScript client, so it is one of the two pages
              here that cannot do anything without JavaScript. The same person is
              rendered with JavaScript disabled at{" "}
              <code>/people/&lt;id&gt;</code>.
            </p>
          </noscript>
        </main>
      ),
    }),
  );
}
