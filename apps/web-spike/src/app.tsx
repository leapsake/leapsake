import type { IncomingMessage } from "node:http";
import type { CoreApi } from "@leapsake/core";
import { readForm } from "./form-data.js";
import { hydrate, type Hydrated, type HydrateTimings, storeMode } from "./hydrate.js";
import { probe } from "./probe.js";
import { proxyRelay } from "./relay-proxy.js";
import { redirect, text, type Reply } from "./reply.js";
import { clientPage } from "./routes/client.js";
import { clientWorkerPage } from "./routes/client-worker.js";
import { driverContractPage } from "./routes/driver-contract.js";
import { duplicatesPage } from "./routes/duplicates.js";
import { hostedViewPage } from "./routes/hosted-view.js";
import { loginPage, loginSubmit } from "./routes/login.js";
import { peoplePage } from "./routes/people.js";
import { personPage } from "./routes/person.js";
import { personDeletePage, personDeleteSubmit } from "./routes/person-delete.js";
import { personEditPage, personEditSubmit } from "./routes/person-edit.js";
import { personNewPage, personNewSubmit } from "./routes/person-new.js";
import { shareNewPage, shareNewSubmit } from "./routes/share-new.js";
import { shareViewPage } from "./routes/share-view.js";
import {
  CLEAR_COOKIE,
  closeSession,
  resolveSession,
  setPushHwm,
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
  render: (
    core: CoreApi,
    session: OpenSession,
    hydrated: Hydrated,
  ) => Promise<Reply>,
): Promise<Reply> {
  const session = resolveSession(req.headers.cookie);
  if (session === null) return redirect("/login");

  const hydrated = await hydrate(session);
  try {
    return withTimings(
      await render(hydrated.core, session, hydrated),
      hydrated.timings,
    );
  } finally {
    // The two halves of §9.2's "memory-only, request-scoped, zeroized", in the
    // one place that can guarantee both run: the decrypted store goes, then the
    // request's copy of the key material.
    hydrated.release();
    session.close();
  }
}

/**
 * Serve a **write**: the read lifecycle, plus the push that makes it leave.
 *
 * Everything about this is the same as `authenticated` except the last two
 * lines, and those two lines are Increment 3's whole claim. Desktop's actions
 * end at the `core` call because a background sync loop carries the row away
 * afterwards; a stateless SSR host has no loop and no next tick it owns, so the
 * push has to happen inside the request, before the 303.
 *
 * Under a cold store that is not a design preference, it is forced — and the
 * forcing is what makes the round trip impossible to fake. The GET the browser
 * makes after the 303 discards this database and rebuilds it from the relay, so
 * a write that was not pushed is not merely invisible to peers: it is invisible
 * to the page that just made it.
 *
 * ## Where the push starts from — the increment's most expensive mistake
 *
 * The plan doc prescribed `session.pushHwm = await engine.push(session.pushHwm)`,
 * starting from 0 because a cold host has no durable `sync_state` row. That is
 * the `WEB_SPIKE_PUSH_MARK=session` arm, and it is **wrong in a way that
 * compounds**: the mark starts at 0, so a session's first write re-pushes the
 * whole store, and the relay is an append-only log with no compaction — those
 * ~150 duplicate versions are permanent, and a cold host `pull(0)`s them back
 * on every request forever. Measured: five logins-with-one-write took a
 * 128-record account to 1 073 and its list page from 6.6 ms to 31.2 ms, while
 * twenty-five writes *inside one session* added 157 records and no measurable
 * time.
 *
 * The default arm fixes it with no durable state — see `Hydrated.pushMark`. The
 * session mark is kept as a floor so the two arms are comparable rather than
 * exclusive.
 */
const pushMarkMode = process.env.WEB_SPIKE_PUSH_MARK === "session" ? "session" : "pull";

async function writing(
  req: IncomingMessage,
  run: (core: CoreApi, form: URLSearchParams) => Promise<Reply>,
): Promise<Reply> {
  const form = await readForm(req);
  return authenticated(req, async (core, session, hydrated) => {
    const writeStarted = performance.now();
    const reply = await run(core, form);
    const writeMs = Math.round((performance.now() - writeStarted) * 10) / 10;

    const from =
      pushMarkMode === "session"
        ? session.pushHwm
        : Math.max(session.pushHwm, hydrated.pushMark);

    const before = hydrated.transportStats();
    const pushStarted = performance.now();
    const hwm = await hydrated.engine.push(from);
    const pushMs = Math.round((performance.now() - pushStarted) * 10) / 10;
    const after = hydrated.transportStats();
    setPushHwm(session.id, hwm);

    console.log(
      `  write ${writeMs} ms  push ${pushMs} ms  ` +
        `${after.records - before.records} records / ` +
        `${((after.bytes - before.bytes) / 1024).toFixed(1)} KiB up  ` +
        `(mark ${pushMarkMode}${from === 0 ? " 0 — whole store" : ""})`,
    );
    return reply;
  });
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

  // Increment 5a, and it sits here — above the session — because a driver test
  // needs no account: the browser data layer either works or it does not, and
  // nothing about a relay or a key can be blamed for the answer.
  if (method === "GET" && path === "/driver-contract") return driverContractPage();

  // Increment 5b, and it sits beside 5a for the same reason: the browser client
  // brings its own login, so this host holds no session for it. Everything below
  // this line is the SSR host; these two pages and the forwarder are the client.
  if (method === "GET" && path === "/client") return clientPage();

  // Increment 5c: the same client with its data layer in a Worker and its
  // database in OPFS. It sits beside 5b's rather than replacing it, because the
  // main-thread page is the baseline the worker page is read against.
  if (method === "GET" && path === "/client-worker") return clientWorkerPage();

  // The relay, from the browser's own origin — a spike affordance standing in
  // for the CORS headers the relay does not send, and `relay-proxy.ts` is
  // emphatic about not letting it launder that into "no relay change needed".
  if (path.startsWith("/relay/")) {
    return proxyRelay(req, path.slice("/relay".length) + url.search);
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

  // Create sits above the `:id` patterns, because `/people/new` matches both and
  // the literal has to win — the one ordering hazard of hand-written routing.
  if (path === "/people/new") {
    if (method === "GET") return authenticated(req, (core) => personNewPage(core));
    if (method === "POST") return writing(req, personNewSubmit);
  }

  // The two share flavors of §11, and the routing tells them apart before
  // anything else does: `/share/*` is served without a session (a share is for
  // someone with no account), so both viewers sit *outside* `authenticated`
  // while the maker of a share sits inside it.
  if (path === "/share/new") {
    if (method === "GET") {
      return authenticated(req, (core) =>
        shareNewPage(core, url.searchParams.get("person")),
      );
    }
    if (method === "POST") {
      const form = await readForm(req);
      // The absolute link has to be built from something, and `Host` is what a
      // browser sends. A real host reads a configured public origin instead —
      // `Host` is attacker-controlled, and a share link is exactly the kind of
      // value that must not be poisoned by it.
      const origin = `http://${req.headers.host ?? "localhost:5180"}`;
      return authenticated(req, (core) => shareNewSubmit(core, form, origin));
    }
  }

  const capability = /^\/share\/([^/]+)$/.exec(path);
  if (method === "GET" && capability !== null) {
    // `req.url` verbatim, because the point of this route is what it *did not*
    // receive — see `share-view.tsx`.
    return shareViewPage(capability[1] as string, req.url ?? "");
  }

  const hosted = /^\/hosted\/([^/]+)$/.exec(path);
  if (method === "GET" && hosted !== null) {
    return hostedViewPage(hosted[1] as string);
  }

  if (method === "GET" && path === "/duplicates") {
    return authenticated(req, (core) =>
      duplicatesPage(core, url.searchParams.get("for")),
    );
  }

  // The framework-shaped part done by hand: one path parameter, one segment deep
  // — now with a verb after it, which is where the cost of no router shows. A
  // framework pairs each route's loader with its action; here the GET and the
  // POST of one screen are two arms of the same `if`, and keeping them adjacent
  // is a convention rather than something the code enforces.
  const person = /^\/people\/([^/]+)(?:\/(edit|delete))?$/.exec(path);
  if (person !== null) {
    const id = person[1] as string;
    switch (`${method} ${person[2] ?? ""}`) {
      case "GET ":
        return authenticated(req, (core) => personPage(core, id));
      case "GET edit":
        return authenticated(req, (core) => personEditPage(core, id));
      case "POST edit":
        return writing(req, (core, form) => personEditSubmit(core, id, form));
      case "GET delete":
        return authenticated(req, (core) => personDeletePage(core, id));
      case "POST delete":
        return writing(req, (core) => personDeleteSubmit(core, id));
    }
  }

  return text(404, "not found\n");
}

/** Printed at boot, so a run's numbers are never read under the wrong heading. */
export const bootBanner = `store mode: ${storeMode}, push mark: ${pushMarkMode}`;
