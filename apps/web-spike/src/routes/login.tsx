import { relayUrl } from "../relay-proxy.js";
import { openSession } from "../session.js";
import { redirect, type Reply } from "../reply.js";
import { renderPage } from "../render.js";

/**
 * The one screen the shared UI does not supply, because it is not about a
 * person: username + password → a session.
 *
 * A hand-written `<form>` rather than `FormShell`, since there is no shared login
 * component to reuse and inventing one would be product work. What it does share
 * with every other page here is that it is *only* a form — no script, no fetch,
 * and the browser posts it itself.
 */

export function loginPage(opts: { failed: boolean }): Reply {
  return {
    status: opts.failed ? 401 : 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    body: renderPage({
      title: "Log in",
      children: (
        <main>
          <h1>Leapsake</h1>
          {opts.failed && <p role="alert">That username or password is wrong.</p>}
          <form method="post" action="/login">
            <p>
              <label htmlFor="username">Username</label>{" "}
              <input id="username" name="username" autoComplete="username" />
            </p>
            <p>
              <label htmlFor="password">Password</label>{" "}
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
              />
            </p>
            <button type="submit">Log in</button>
          </form>
          <p>
            <small>
              Relay: <code>{relayUrl}</code>
            </small>
          </p>
        </main>
      ),
    }),
  };
}

/**
 * Log in and set the session cookie.
 *
 * This is the only request in a session that pays Argon2id — ~355 ms of it,
 * during which the whole host is stalled (Increment 1, finding 2). The numbers go
 * to the console rather than the page: a real client would want them in a metric,
 * and the spike wants them beside the per-request timings they contrast with.
 */
export async function loginSubmit(form: URLSearchParams): Promise<Reply> {
  const username = form.get("username")?.trim() ?? "";
  const password = form.get("password") ?? "";
  if (username === "" || password === "") return loginPage({ failed: true });

  try {
    const { cookie, argon2Ms, argon2LagMs } = await openSession({
      relayUrl,
      username,
      password,
    });
    console.log(
      `login  ${username}  argon2id ${argon2Ms} ms  (host stalled ${argon2LagMs} ms)`,
    );
    return redirect("/people", { "set-cookie": cookie });
  } catch (error) {
    // A wrong password fails at the relay's bootstrap check, not at an unwrap:
    // the derived verifier simply does not match, so this is a 401 and not a
    // decrypt error. Anything else — relay down, no such user — lands here too,
    // and the page does not distinguish them for the same reason a login form
    // never does.
    console.log(`login failed for ${username}: ${String(error)}`);
    return loginPage({ failed: true });
  }
}
