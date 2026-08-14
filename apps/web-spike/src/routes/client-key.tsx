import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **Increment 5e's page**: what a browser has instead of an enclave.
 *
 * 5c's client already survives a reload in every respect but one — the store,
 * the schema and the sync cursor are all still there, and the master key is not,
 * so a warm start pays a full Argon2id and two network calls to recover a key
 * the tab held a minute ago. This page persists the key too, under a
 * **non-extractable `CryptoKey` in IndexedDB**, and then proves the warm start
 * needs neither the password nor the relay.
 *
 * The server's job is `/client-worker`'s exactly: serve this markup, serve the
 * modules, forward `/relay/*` — and on a resume it is not even asked for the
 * third. The worker is the same file; the page differs by having two ways in.
 *
 * Like the other client pages this one's subject **is** JavaScript, so the
 * spike's no-JS floor does not apply and the `<noscript>` says so.
 */
export function clientKeyPage(): Reply {
  return html(
    renderPage({
      title: "Key custody in a browser",
      script: "/src/client/client-key-app.tsx",
      react: true,
      children: (
        <main>
          <h1>Key custody in a browser</h1>
          <p>
            The master key, wrapped under a <strong>non-extractable</strong>{" "}
            <code>CryptoKey</code> that lives in IndexedDB — the closest thing a
            browser has to the OS enclave desktop and mobile hand the{" "}
            <code>KeyStore</code> port. Log in once with a password, then{" "}
            <strong>reload</strong>: the second start unwraps the key, opens the
            OPFS database, decrypts a record the relay sent, and renders the
            person — with no password typed and{" "}
            <code>fetch</code> disabled for the duration.
          </p>

          <p id="custody">
            <small>Starting the worker…</small>
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
              Log in the expensive way, and mint a wrap
            </button>
          </form>

          <p id="resume-form" hidden>
            <button type="button" id="resume">
              Resume — no password
            </button>{" "}
            <small>
              Nothing here calls the relay: the worker replaces{" "}
              <code>fetch</code> with a throw and the verdict reports the count.
            </small>
          </p>

          <div id="stages" />
          <pre id="verdict" style={{ whiteSpace: "pre-wrap" }} />

          <p>
            <button type="button" id="forget">
              Forget the wrap
            </button>{" "}
            <small>
              Logout, custody-shaped: the store stays, the key does not.
            </small>
            <br />
            <button type="button" id="wipe">
              Wipe the OPFS database and the wrap
            </button>{" "}
            <small>Then reload for a genuinely cold start.</small>
          </p>

          <div id="app" />

          <noscript>
            <p>
              This page is the JavaScript client, so like <code>/client</code>{" "}
              and <code>/client-worker</code> it cannot do anything without
              JavaScript.
            </p>
          </noscript>
        </main>
      ),
    }),
  );
}
