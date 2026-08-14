import { html, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * **Increment 5c's page**: 5b's client with its data layer in a Worker and its
 * database in OPFS — so the tab stays interactive through the login, and a
 * reload does not pull the account again.
 *
 * The server's job is the same as `/client`'s and just as small: serve this
 * markup, serve the modules, forward `/relay/*`. It holds no session, no key and
 * no store, and now it does not hold the *database* either — that is in the
 * browser's origin-private file system, where it survives the tab.
 *
 * The furniture below is the measurement, not decoration. The moving bar and the
 * frame counter are how "the page stayed interactive" is *shown* rather than
 * asserted, and the text field is the same claim in the form a person can feel:
 * type in it while the login runs, and the characters arrive. On 5b's page
 * neither would move for the better part of a second.
 *
 * Like `/client` and `/driver-contract` this page's subject **is** JavaScript, so
 * the spike's no-JS floor does not apply and the `<noscript>` says so.
 */
export function clientWorkerPage(): Reply {
  return html(
    renderPage({
      title: "Client-side login, in a Worker",
      script: "/src/client/client-worker-app.tsx",
      react: true,
      children: (
        <main>
          <h1>Client-side login in a Worker, with an OPFS database</h1>
          <p>
            The same login as <code>/client</code>, moved one thread over:
            Argon2id, sqlite-wasm, the master key, the sync engine and{" "}
            <code>core</code> all live in a Worker, and this page talks to them
            over a <code>postMessage</code> proxy. The database is{" "}
            <strong>OPFS</strong>, so it outlives the tab — log in, then reload,
            and watch the pull come back empty.
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
            <small id="opfs">Starting the worker…</small>
          </form>

          <section
            style={{
              border: "1px solid #ccc",
              borderRadius: "0.4rem",
              padding: "0.6rem 0.9rem",
              margin: "1rem 0",
            }}
          >
            <p style={{ margin: "0 0 0.4rem" }}>
              <strong>Is the main thread alive?</strong>{" "}
              <small id="meter">starting…</small>
            </p>
            <div
              id="spinner"
              style={{
                width: "1.5rem",
                height: "1.5rem",
                background: "#357",
                borderRadius: "0.2rem",
              }}
            />
            <p style={{ marginBottom: 0 }}>
              <label htmlFor="echo">Type here while it logs in</label>{" "}
              <input id="echo" autoComplete="off" />{" "}
              <small id="echo-count" />
            </p>
          </section>

          <div id="stages" />
          <pre id="verdict" style={{ whiteSpace: "pre-wrap" }} />
          <p>
            <button type="button" id="wipe">
              Wipe the OPFS database
            </button>{" "}
            <small>
              Then reload for a cold start. Persistence is the point, so getting
              back to zero has to be deliberate.
            </small>
          </p>
          <div id="app" />

          <noscript>
            <p>
              This page is the JavaScript client, so like <code>/client</code> it
              cannot do anything without JavaScript. The same person is rendered
              with JavaScript disabled at <code>/people/&lt;id&gt;</code>.
            </p>
          </noscript>
        </main>
      ),
    }),
  );
}
