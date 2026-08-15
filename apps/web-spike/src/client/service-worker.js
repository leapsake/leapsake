/**
 * **Increment 5d's service worker**: the asset half of an offline reload.
 *
 * 5c made the store, the schema and the sync cursor survive a reload, and 5e
 * made the master key survive one. All three are useless with the network down
 * if the *page* cannot load: the HTML, the module graph and 864 KiB of
 * `sqlite3.wasm` all come from a server that is not answering. This caches them,
 * and that is the whole of what 5d adds to the client.
 *
 * ## Why this file is plain JavaScript, and served from `/sw.js`
 *
 * A service worker may only control URLs **under the path it was served from**,
 * so a worker served at `/src/client/service-worker.ts` controls `/src/client/`
 * and nothing else — not the page, not the `.wasm` under `/@fs/`. The two ways
 * out are a `Service-Worker-Allowed: /` header on the module Vite serves, or
 * serving the file from the root. The spike takes the second: `app.tsx` reads
 * this file off disk at `/sw.js`, which means it never enters Vite's module
 * graph, which means it must be JavaScript rather than TypeScript. That is not a
 * workaround so much as what production looks like anyway — a service worker is
 * a separate top-level script with its own lifecycle, and every bundler ships a
 * special case for it.
 *
 * ## Network-first, and only over the shell
 *
 * Two rules, and the second one is the finding worth carrying:
 *
 * 1. **Network-first, cache as a fallback.** A real PWA precaches a build
 *    manifest of hashed filenames and goes cache-first, because those URLs are
 *    immutable. A Vite dev server's module URLs are not: they are transformed on
 *    demand and re-stamped with `?t=` on every edit, so cache-first would serve
 *    yesterday's module and the spike would spend its afternoon debugging a
 *    stale bundle. Network-first costs nothing here (localhost) and makes the
 *    offline claim strictly weaker in the right direction: everything came from
 *    the cache *because nothing else could*.
 * 2. **Only the shell is cached — never a page carrying user data.** The SSR
 *    host sends `Cache-Control: private, no-store` on every response, and
 *    **Cache Storage does not care**: it is not the HTTP cache, and `cache.put`
 *    stores a `no-store` response as happily as any other. So the one thing
 *    keeping decrypted people out of a disk cache on this origin is the
 *    allowlist in {@link isShell} — the service worker has to be told which
 *    half of its own origin is an app and which half is somebody's data.
 */

const CACHE = "leapsake-spike-5d";

/**
 * What may be cached: the PWA page, its manifest and icons, and everything Vite
 * serves it.
 *
 * Everything else falls through untouched — `/relay/*` (the account's
 * ciphertext, and a POST besides), and every SSR route (`/people/*`, `/login`,
 * `/share/*`), which render decrypted user data into HTML. A pass-through here
 * is a request the service worker never sees the body of.
 */
function isShell(url) {
  const path = url.pathname;
  return (
    path === "/client-pwa" ||
    path === "/manifest.webmanifest" ||
    path.startsWith("/icon-") ||
    // Vite's three families: source modules, its own virtual/`/@fs/` URLs (the
    // `.wasm` arrives through one, because the workspace is hoisted), and the
    // pre-bundled dependencies.
    path.startsWith("/src/") ||
    path.startsWith("/@") ||
    path.startsWith("/node_modules/")
  );
}

/**
 * A timestamped log of what this worker did with each request, capped.
 *
 * Timestamps rather than per-client counters, because the fetch that matters
 * most — 864 KiB of `sqlite3.wasm` — is made by the *Worker*, which is its own
 * service-worker client with its own id and no way for the page to learn it. A
 * page asking "what happened since I started" (`performance.timeOrigin`) gets
 * its own load whichever thread made the requests.
 *
 * The log dies if the browser restarts this worker mid-load, in which case the
 * counts read low and the page's other two witnesses carry the claim.
 */
const log = [];

function tally(outcome, url) {
  log.push({ at: Date.now(), outcome, url });
  if (log.length > 400) log.splice(0, log.length - 400);
}

function since(from) {
  const counts = { network: 0, cache: 0, missing: 0 };
  for (const entry of log) {
    if (entry.at >= from) counts[entry.outcome] += 1;
  }
  return counts;
}

self.addEventListener("install", (event) => {
  // No precache list: in dev there is no build manifest to precache *from*, and
  // the runtime cache below fills on the first controlled load. `skipWaiting`
  // because a spike should never need a second reload to pick up an edit.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      // Claim, so the page that registered this worker is controlled *now*.
      // It does not retroactively cache that page's own module graph — those
      // fetches already happened uncontrolled — which is why the page tells the
      // user whether it is offline-ready and asks for one reload if not.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!isShell(url)) return;

  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    tally("network", request.url);
    return response;
  } catch {
    const cached = await fromCache(request);
    if (cached !== undefined) {
      tally("cache", request.url);
      return cached;
    }
    tally("missing", request.url);
    return new Response(
      `offline, and ${request.url} is not in the cache — load it once with the server up`,
      { status: 504, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
}

/**
 * Exact URL first, then the same URL without its query.
 *
 * The fallback is a dev-server concession with a real cost, recorded rather than
 * hidden: Vite stamps `?v=<hash>` onto pre-bundled dependencies and `?t=<ms>`
 * onto anything it has re-transformed, so a restarted server asks for URLs the
 * cache was filled under different queries. Ignoring the query recovers those,
 * and would confuse two modules that genuinely differ only by query string. A
 * production build, whose filenames carry the hash instead, needs none of it.
 */
async function fromCache(request) {
  const cache = await caches.open(CACHE);
  return (
    (await cache.match(request, { ignoreVary: true })) ??
    (await cache.match(request, { ignoreVary: true, ignoreSearch: true }))
  );
}

/** Answer over the port the page opened, so each question gets its own reply. */
function reply(event, data) {
  const port = event.ports[0];
  if (port !== undefined) port.postMessage(data);
  else event.source?.postMessage(data);
}

self.addEventListener("message", (event) => {
  const message = event.data;
  if (message === null || typeof message !== "object") return;

  if (message.kind === "stats") {
    void (async () => {
      const cache = await caches.open(CACHE);
      const keys = await cache.keys();
      // `missing` is the list the page checks its own resource timing against:
      // anything it loaded this time that would not be there next time.
      const missing = [];
      for (const url of message.urls ?? []) {
        if ((await fromCache(new Request(url))) === undefined) missing.push(url);
      }
      reply(event, {
        kind: "stats",
        mine: since(message.since ?? 0),
        total: since(0),
        cached: keys.length,
        missing,
      });
    })();
  }

  if (message.kind === "warm") {
    // The first load registers this worker *after* its own modules have been
    // fetched, so nothing it used is in the cache yet. Rather than tell the user
    // to reload, the page hands over the URL list the browser gave it
    // (`performance.getEntriesByType("resource")`) and this fetches them once.
    void (async () => {
      const cache = await caches.open(CACHE);
      let added = 0;
      for (const url of message.urls ?? []) {
        try {
          if (!isShell(new URL(url))) continue;
          const response = await fetch(url);
          if (response.ok) {
            await cache.put(new Request(url), response);
            added += 1;
          }
        } catch {
          // Offline, or the server went away mid-warm. Nothing to do: the point
          // of warming is to make the *next* load work, and it will report.
        }
      }
      reply(event, { kind: "warmed", added });
    })();
  }

  if (message.kind === "clear") {
    void caches.delete(CACHE).then(() => {
      log.length = 0;
      reply(event, { kind: "cleared" });
    });
  }
});
