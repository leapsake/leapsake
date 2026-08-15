import { readFile } from "node:fs/promises";
import { iconPng } from "../icon.js";
import type { Reply } from "../reply.js";

/**
 * The three things a page needs before Chrome will treat it as an app: a
 * manifest, icons, and a service worker served from the scope it claims.
 *
 * None of it is interesting on its own. It is here because **an installed
 * origin is a different origin as far as storage is concerned** — 5e found
 * `navigator.storage.persist()` refused on `localhost`, leaving the OPFS
 * database and the wrapped master key both evictable, and "Chrome grants
 * durability to installed or highly-engaged origins" is the hypothesis 5d
 * exists to test. It cannot be tested without an install, and Chrome will not
 * offer one without these three files.
 */

/**
 * `start_url` is the client, not `/`.
 *
 * A launched PWA opens `start_url`, and `/` on this host is the *SSR* app — the
 * no-JS client with a server-side session, which is a different product with a
 * different trust model. `scope: "/"` stays wide because the service worker
 * needs to cache Vite's `/src/`, `/@fs/` and `/node_modules/` URLs, which sit
 * nowhere near the page.
 */
const MANIFEST = {
  name: "Leapsake web spike",
  short_name: "Leapsake",
  description:
    "Increment 5d: the browser client as an installed app, offline against its own OPFS database.",
  start_url: "/client-pwa",
  scope: "/",
  display: "standalone",
  background_color: "#103d3a",
  theme_color: "#103d3a",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

export function manifestReply(): Reply {
  return {
    status: 200,
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
    body: JSON.stringify(MANIFEST, null, 2),
  };
}

export function iconReply(size: number): Reply {
  return {
    status: 200,
    headers: { "content-type": "image/png" },
    body: iconPng(size),
  };
}

/**
 * `/sw.js`, read off disk rather than served through Vite.
 *
 * A service worker controls only URLs **at or below the path it was served
 * from**, so the module URL Vite would give it (`/src/client/service-worker.ts`)
 * would control `/src/client/` and nothing else — not the page, not the
 * `.wasm`. Serving it from the root sidesteps the `Service-Worker-Allowed`
 * header and keeps it out of the module graph, which is why it is the one
 * `.js` file in `src/`: nothing transforms it, so it cannot be TypeScript.
 *
 * Read per request, so editing it needs no restart. `no-store` is already on
 * every response from this host, and for a service worker that is the right
 * answer anyway — a stale one is the classic way to ship a PWA nobody can
 * update.
 */
export async function serviceWorkerReply(): Promise<Reply> {
  const source = await readFile(
    new URL("../client/service-worker.js", import.meta.url),
    "utf8",
  );
  return {
    status: 200,
    headers: { "content-type": "text/javascript; charset=utf-8" },
    body: source,
  };
}
