import type { IncomingMessage } from "node:http";
import type { CoreApi } from "@leapsake/core";
import { readForm } from "./form-data.js";
import { hydrate, type HydrateTimings, storeMode } from "./hydrate.js";
import { probe } from "./probe.js";
import { redirect, text, type Reply } from "./reply.js";
import { loginPage, loginSubmit } from "./routes/login.js";
import { peoplePage } from "./routes/people.js";
import { personPage } from "./routes/person.js";
import {
  CLEAR_COOKIE,
  closeSession,
  resolveSession,
  type OpenSession,
} from "./session.js";

/**
 * Every route the spike serves, as a `switch` on method + pathname.
 *
 * Bare on purpose — the framework question stays open, so this mirrors
 * `apps/server/src/relay.ts`'s handler rather than adopting a router. What that
 * costs is visible here and is part of the answer: path parameters are string
 * surgery, and the loader/action pairing a framework would give for free is
 * hand-written below.
 *
 * The whole module graph lives **inside Vite's SSR loader** (`server.ts` reaches
 * it through `ssrLoadModule` and imports nothing from it directly). That is not a
 * style choice: `session.ts` and `hydrate.ts` hold module state, and a module
 * loaded twice — once by `tsx` for the HTTP shell, once by Vite for the render —
 * would give the session store and the warm-store map one instance each, with
 * requests landing on whichever half happened to import them. One graph, one set
 * of state. The consequence to know while developing: editing a file in this
 * graph invalidates it, and open sessions go with it.
 */

/** Serve a request that needs an account, or send it to the login page. */
async function authenticated(
  req: IncomingMessage,
  render: (core: CoreApi, session: OpenSession) => Promise<Reply>,
): Promise<Reply> {
  const session = resolveSession(req.headers.cookie);
  if (session === null) return redirect("/login");

  const hydrated = await hydrate(session);
  try {
    return withTimings(await render(hydrated.core, session), hydrated.timings);
  } finally {
    // The two halves of §9.2's "memory-only, request-scoped, zeroized", in the
    // one place that can guarantee both run: the decrypted store goes, then the
    // request's copy of the key material.
    hydrated.release();
    session.close();
  }
}

/**
 * Attach the hydrate cost to the response as `Server-Timing`, and log it.
 *
 * A header rather than a footer in the page, so the numbers survive `curl` and
 * cost the rendered HTML nothing — the browser shows them in the network panel.
 * This is the cold-vs-warm measurement in its final form: `total` is what a user
 * waited for beyond the render itself, and in the default configuration it
 * contains **no Argon2id at all**, because the key was already warm in the
 * session store.
 */
function withTimings(reply: Reply, t: HydrateTimings): Reply {
  const decryptMs = Math.round((t.pullMs - t.transportMs) * 10) / 10;
  console.log(
    `${t.mode}${t.reused ? " (reused)" : ""}  store ${t.storeMs} ms  ` +
      `pull ${t.pullMs} ms (transport ${t.transportMs}, decrypt+apply ${decryptMs})  ` +
      `${t.applied} applied / ${t.records} records / ${(t.bytes / 1024).toFixed(1)} KiB  ` +
      `total ${t.totalMs} ms`,
  );
  return {
    ...reply,
    headers: {
      ...reply.headers,
      "server-timing": [
        `store;dur=${t.storeMs}`,
        `transport;dur=${t.transportMs}`,
        `decrypt;dur=${decryptMs}`,
        `total;dur=${t.totalMs}`,
      ].join(", "),
    },
  };
}

export async function handleRequest(req: IncomingMessage): Promise<Reply> {
  const url = new URL(req.url ?? "/", "http://web-spike");
  const { method } = req;
  const path = url.pathname;

  if (method === "GET" && path === "/health") return text(200, "ok\n");

  // Increment 1's answer, kept: the shared UI loads through Vite's SSR pipeline.
  // Increment 2 supersedes it by rendering the same screen for real, but a
  // one-request check that isolates *loading* from *rendering* is worth the line
  // it costs the next time something in the bundler moves.
  if (method === "GET" && path === "/probe") {
    return text(200, `@leapsake/ui loaded via SSR: ${probe().screen}\n`);
  }

  if (method === "GET" && path === "/") return redirect("/people");

  if (method === "GET" && path === "/login") return loginPage({ failed: false });
  if (method === "POST" && path === "/login") {
    return loginSubmit(await readForm(req));
  }

  if (method === "POST" && path === "/logout") {
    const session = resolveSession(req.headers.cookie);
    if (session !== null) {
      closeSession(session.id);
      session.close();
    }
    return redirect("/login", { "set-cookie": CLEAR_COOKIE });
  }

  if (method === "GET" && path === "/people") {
    return authenticated(req, (core, session) =>
      peoplePage(core, session.username),
    );
  }

  // The framework-shaped part done by hand: one path parameter, one segment deep.
  const person = /^\/people\/([^/]+)$/.exec(path);
  if (method === "GET" && person !== null) {
    return authenticated(req, (core) => personPage(core, person[1] as string));
  }

  return text(404, "not found\n");
}

/** Printed at boot, so a run's numbers are never read under the wrong heading. */
export const bootBanner = `store mode: ${storeMode}`;
