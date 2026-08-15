import { createWorkerClient } from "./core-proxy.js";
import { clientGiftsPorts } from "./gifts-ports-client.js";
import { storageStatus } from "./key-custody.js";
import { mountPersonApp } from "./person-app.js";
import type { ResumeSummary, Stage } from "./worker-protocol.js";

/**
 * **Increment 5d**: the main-thread half of the client as an installed app.
 *
 * 5e's page proved a reload needs no password and no relay. This one proves it
 * needs no *server*, which is a different claim with a different failure mode:
 * the data was already local, and the **assets** were not. So the interesting
 * code here is not the client — that is 5c's worker and 5e's resume, unchanged
 * — but the three things around it:
 *
 * 1. **A service worker** (`service-worker.js`), registered here and asked
 *    afterwards what it actually cached, so "offline-ready" is a checked
 *    property rather than a hope.
 * 2. **Auto-resume.** A launched app shows its data; it does not show a button
 *    that shows its data. The one click left is a password, and only when
 *    custody is empty.
 * 3. **Three independent witnesses that the network was not used**, because the
 *    obvious one is not enough on its own — see {@link report}.
 *
 * ## The first load cannot cache itself
 *
 * A page that registers a service worker has already fetched its own modules by
 * the time the worker activates, so nothing it used is in the cache and a naive
 * PWA needs a second reload before it works offline. The browser knows exactly
 * what was fetched, though — `performance.getEntriesByType("resource")` — and
 * so does the *worker*, which reports its own list in its `ready` message
 * because a page cannot see a worker's resource timing. Handing both lists to
 * the service worker to fetch once ("warm") makes the first load enough.
 */

// --- Page furniture, the same shape 5c's and 5e's pages use -------------------

const stagesHost = document.getElementById("stages");
const table = document.createElement("table");
table.style.borderSpacing = "0.75rem 0.15rem";
stagesHost?.appendChild(table);

function stage(label: string, ms: number | null, detail = ""): void {
  const row = document.createElement("tr");
  const name = document.createElement("td");
  name.textContent = label;
  const cost = document.createElement("td");
  cost.style.textAlign = "right";
  cost.textContent = ms === null ? "" : `${ms} ms`;
  const note = document.createElement("td");
  note.textContent = detail;
  note.style.color = "#555";
  row.append(name, cost, note);
  table.appendChild(row);
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function say(id: string, text: string): void {
  const host = document.getElementById(id);
  if (host !== null) host.textContent = text;
}

function show(id: string, visible: boolean): void {
  const host = document.getElementById(id);
  if (host !== null) host.hidden = !visible;
}

/** A span in whatever unit reads as a span — a queued tab can wait for minutes. */
function duration(ms: number): string {
  if (ms < 5_000) return `${round(ms)} ms`;
  if (ms < 90_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

function ago(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 90) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

// --- The service worker, and the two questions worth asking it ----------------

interface Tally {
  network: number;
  cache: number;
  missing: number;
}

interface StatsReply {
  kind: "stats";
  mine: Tally;
  total: Tally;
  cached: number;
  missing: string[];
}

/**
 * Post to the service worker and wait for its answer over a `MessageChannel`.
 *
 * A channel per question rather than a shared `message` listener, because the
 * answers are request/response and the page asks twice — once for the load's
 * own numbers, once after warming the cache.
 */
async function askWorker<T>(message: unknown): Promise<T | null> {
  const controller = navigator.serviceWorker.controller;
  if (controller === null) return null;
  return new Promise<T>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<T>) => {
      resolve(event.data);
    };
    controller.postMessage(message, [channel.port2]);
  });
}

/**
 * Every URL this load needed, from the two timelines that know: the page's own,
 * and the worker's.
 *
 * The document itself is added by hand — a navigation is not a resource entry,
 * and it is the one request an offline reload cannot do without.
 */
function loadedUrls(workerResources: readonly string[]): string[] {
  const page = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name);
  return [...new Set([location.href, ...page, ...workerResources])];
}

/**
 * The browser's own account of the load: bytes on the wire, and where each
 * response came from.
 *
 * `deliveryType` is the witness that settles it — Chrome reports
 * `"cache-storage"` for anything a service worker answered out of the Cache
 * API, `"cache"` for its own HTTP cache, and `""` for the network. Nothing here
 * is the spike's instrumentation, which is the point: the page's own counters
 * could be wrong in a way that flatters the result, and these cannot.
 */
function delivery(): { bytes: number; fromCache: number; fromHttpCache: number; total: number } {
  const entries = [
    ...performance.getEntriesByType("navigation"),
    ...performance.getEntriesByType("resource"),
  ] as PerformanceResourceTiming[];
  return {
    bytes: entries.reduce((total, entry) => total + (entry.transferSize ?? 0), 0),
    fromCache: entries.filter((entry) => entry.deliveryType === "cache-storage").length,
    fromHttpCache: entries.filter((entry) => entry.deliveryType === "cache").length,
    total: entries.length,
  };
}

let registered: ServiceWorkerRegistration | null = null;

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    say("offline-ready", "This browser has no service worker, so nothing here can work offline.");
    return;
  }
  const started = performance.now();
  // Served from the root by `app.tsx`, not by Vite — a worker registered from
  // `/src/client/…` could only ever control `/src/client/…`. See `routes/pwa.ts`.
  registered = await navigator.serviceWorker.register("/sw.js", { type: "classic" });
  await navigator.serviceWorker.ready;
  stage(
    "service worker",
    round(performance.now() - started),
    `registered at scope ${registered.scope}${
      navigator.serviceWorker.controller === null
        ? " — not controlling this load yet"
        : " — controlling this load"
    }`,
  );
}

// --- Storage durability, which is the number 5e could not collect -------------

function installedAs(): string {
  const modes = ["standalone", "minimal-ui", "fullscreen", "window-controls-overlay"];
  const active = modes.find((mode) => matchMedia(`(display-mode: ${mode})`).matches);
  return active ?? "browser tab";
}

async function reportStorage(): Promise<void> {
  const status = await storageStatus();
  say(
    "storage",
    `${status} · running as: ${installedAs()}` +
      (installedAs() === "browser tab"
        ? " — install the app and reload to see whether Chrome's answer changes"
        : ""),
  );
}

// --- The worker, named so it opts into 5d's leader election -------------------

const worker = new Worker(new URL("./core-worker.ts", import.meta.url), {
  type: "module",
  // The `-pwa` suffix is what turns on the Web Locks election in the worker: an
  // installed app is the thing that gets opened twice, and 5c's answer to a
  // second tab was a `DOMException`.
  name: "leapsake-core-pwa",
});

const client = createWorkerClient(
  worker,
  (message: Stage) => {
    stage(message.label, message.ms, message.detail);
  },
  (waiting) => {
    say("custody", `Queued: ${waiting.reason}.`);
    stage("waiting for the store", null, waiting.reason);
    document.title = "waiting for the other tab — PWA";
  },
);

// --- The load, in the order an installed app would want it --------------------

async function boot(): Promise<void> {
  void reportStorage();
  await registerServiceWorker();

  const ready = await client.ready;
  const held = ready.files.length === 0 ? "empty" : ready.files.join(", ");
  stage(
    "worker ready",
    round(ready.initMs + ready.vfsMs),
    `sqlite ${ready.libVersion} (${round(ready.initMs)} ms) + ${ready.vfsName} ` +
      `(${round(ready.vfsMs)} ms) — OPFS holds: ${held}` +
      (ready.waitedMs === undefined
        ? ""
        : ` — took the store lock after waiting ${duration(ready.waitedMs)} for the other ` +
          `tab, then installed the pool on attempt ${ready.attempts ?? 1}`),
  );

  const custody = ready.custody;
  show("login", custody === null);
  if (custody === null) {
    say(
      "custody",
      "No wrap in IndexedDB, so this launch needs the password. Log in once — " +
        "after that the app starts from its own storage.",
    );
    await afterLoad(ready.resources ?? []);
    return;
  }

  say(
    "custody",
    `A wrap is waiting: account ${custody.accountId.slice(0, 8)}…, minted ` +
      `${ago(custody.mintedAt)}. Resuming without a password…`,
  );
  // No button. An app that has its key and its data starts.
  const summary = await client.resume();
  mountPersonApp(client.core, clientGiftsPorts(client.core), summary.people);
  await afterLoad(ready.resources ?? [], summary);
}

/**
 * What the load is worth reporting *after* it has finished: what it fetched,
 * what the cache holds, and whether the next one can do without a server.
 */
async function afterLoad(
  workerResources: readonly string[],
  summary?: ResumeSummary,
  extra?: readonly string[],
): Promise<void> {
  const urls = loadedUrls(workerResources);
  // `timeOrigin` is when *this document* started, so the tally covers this load
  // and nothing before it — including the requests the Worker made on its own
  // client, which the page has no other way to attribute to itself.
  const before = await askWorker<StatsReply>({
    kind: "stats",
    urls,
    since: performance.timeOrigin,
  });
  report(before, summary, extra);

  if (before !== null && before.missing.length > 0) {
    const warmed = await askWorker<{ kind: "warmed"; added: number }>({
      kind: "warm",
      urls: before.missing,
    });
    const after = await askWorker<StatsReply>({
      kind: "stats",
      urls,
      since: performance.timeOrigin,
    });
    stage(
      "warm the cache",
      null,
      `${warmed?.added ?? 0} of ${before.missing.length} missing assets fetched — ` +
        `${after?.missing.length ?? "?"} still missing`,
    );
    say(
      "offline-ready",
      (after?.missing.length ?? 1) === 0
        ? `Offline-ready: all ${urls.length} assets this load used are in the cache. ` +
          `Stop the server and reload.`
        : `Not offline-ready yet: ${after?.missing.length} of ${urls.length} assets are ` +
          `not cached (${after?.missing.slice(0, 3).join(", ") ?? ""}…). Reload once more.`,
    );
    return;
  }

  say(
    "offline-ready",
    before === null
      ? "The service worker is not controlling this load yet — reload once, and it will be."
      : `Offline-ready: all ${urls.length} assets this load used are in the cache ` +
        `(${before.cached} entries in total).`,
  );
}

/**
 * The done-when, as a verdict with **three independent witnesses**.
 *
 * One of them would not be enough, and the reason is the same one 5e gave for
 * removing `fetch` from the worker: "no requests were made" and "no counter was
 * installed" look identical from outside. So the page reads
 *
 * - the **service worker's** per-client tally, which distinguishes a request it
 *   served from cache from one it fetched — and, crucially, counts the ones
 *   that fell back to cache *because the fetch failed*;
 * - the **browser's** resource timing, whose `transferSize` is bytes on the
 *   wire and belongs to nobody's instrumentation;
 * - `navigator.onLine`, which is the only one that distinguishes "DevTools
 *   offline" from "the dev server is not running" — the second leaves the tab
 *   perfectly online and is the stricter test of the two, because the browser
 *   is not being asked to pretend.
 */
function report(
  stats: StatsReply | null,
  summary?: ResumeSummary,
  extra: readonly string[] = [],
): void {
  const wire = delivery();
  const served = stats?.mine ?? { network: 0, cache: 0, missing: 0 };
  const offline = wire.bytes === 0 && wire.fromCache > 0;
  const rendered = summary !== undefined && summary.people.length > 0;

  const lines = [
    offline && rendered
      ? "PASS — this load rendered the person with nothing on the other end of the socket."
      : summary === undefined
        ? "This load used the password. Reload with the server stopped for the offline test."
        : "Online load — the assets came from the server. Stop it and reload for the real test.",
    ...(extra.length === 0 ? [] : ["", ...extra]),
    "",
    // Two counts of the same load that deliberately disagree: the service
    // worker's `network` is *fetches that resolved*, which offline still
    // includes anything Chrome answered out of its own HTTP cache (Vite marks
    // its optimized deps immutable). `deliveryType` below is what actually
    // happened, and it is the browser's word rather than the page's.
    `service worker: ${served.cache} requests fell back to cache when the fetch failed, ` +
      `${served.network} resolved, ${served.missing} in neither` +
      (stats === null ? " (not controlling this load)" : ""),
    `the browser's own account: ${wire.bytes} B crossed the wire for ${wire.total} requests — ` +
      `${wire.fromCache} from the service worker's Cache Storage, ${wire.fromHttpCache} from ` +
      `Chrome's HTTP cache, ${wire.total - wire.fromCache - wire.fromHttpCache} from the network`,
    `navigator.onLine: ${navigator.onLine} — ${
      navigator.onLine
        ? "so a load with zero bytes on the wire means the server is down, not the browser pretending"
        : "DevTools offline, or a genuinely disconnected machine"
    }`,
  ];

  if (summary !== undefined) {
    lines.push(
      "",
      `resumed in ${summary.totalMs} ms with no password: unwrap ${summary.unwrapMs} ms, ` +
        `open the store ${summary.openStoreMs} ms, ${summary.networkCalls} fetch calls ` +
        `(guard ${summary.guardProven ? "proven" : "NOT PROVEN"})`,
      summary.canary === null
        ? "no canary in custody"
        : `opened ${summary.canary.bytes} B of relay ciphertext → “${summary.canary.plaintext}”` +
          `${summary.canary.inStore ? ", the same row the OPFS store holds" : ""}`,
      `rendered ${summary.people.length} people from OPFS; the password was last typed ${ago(
        summary.mintedAt,
      )}`,
    );
  }

  say("verdict", lines.join("\n"));
  if (summary !== undefined) {
    document.title = `${offline ? "OFFLINE PASS" : "online"} ${summary.totalMs} ms — PWA`;
  }
}

// --- The cold path, kept because a wrap has to come from somewhere ------------

async function runLogin(username: string, password: string): Promise<void> {
  const startedAt = performance.now();
  const summary = await client.login(username, password);
  stage("total, click to first render", round(performance.now() - startedAt), "");
  mountPersonApp(client.core, clientGiftsPorts(client.core), summary.people);
  show("login", false);
  say(
    "custody",
    `Wrap minted (${summary.custody.ms} ms). From here the app launches without ` +
      "the password — reload with the server stopped and see.",
  );
  document.title = `minted ${summary.totalMs} ms — PWA`;
  await afterLoad([], undefined, [
    // The measurement the spike still owes, and this is one of the two pages
    // that can collect it — see the plan doc's fourth teardown check. It is
    // only worth reading when the tab stayed visible: 5c measured a hidden
    // tab's worker five times and got a three-fold spread.
    `Argon2id ${summary.argon2Ms} ms on the worker thread, tab ` +
      `${document.visibilityState} — the worker stalled ${summary.argon2LagMs} ms across ` +
      `the KDF and ${summary.workerLagMs} ms across the whole login`,
    `the login cost ${summary.totalMs} ms in total, so the KDF is ` +
      `${Math.round((summary.argon2Ms / summary.totalMs) * 100)}% of it`,
    `pull(${summary.cursorBefore}) applied ${summary.applied} of ${summary.records} records`,
  ]);
}

// --- Wiring -------------------------------------------------------------------

function fail(error: unknown): void {
  stage("failed", null, String(error));
  document.title = "FAIL — PWA";
  console.error(error);
}

document.getElementById("login")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const read = (id: string): string => {
    const field = document.getElementById(id);
    return field instanceof HTMLInputElement ? field.value : "";
  };
  runLogin(read("username"), read("password")).catch(fail);
});

document.getElementById("forget")?.addEventListener("click", () => {
  client.forget().then((message) => {
    stage("forgot the wrap", null, message);
    show("login", true);
    say("custody", "The wrap is gone. The store is still there; the key is not.");
  }, fail);
});

document.getElementById("wipe")?.addEventListener("click", () => {
  client.wipe().then((files) => {
    stage("wiped the OPFS pool and the wrap", null, `${files.length} files left`);
  }, fail);
});

// The asset half, on its own button, because the whole increment is about the
// three halves being independent: dropping the cache leaves the OPFS database
// and the key untouched, and costs exactly one online reload to rebuild.
document.getElementById("uncache")?.addEventListener("click", () => {
  void askWorker({ kind: "clear" }).then(() => {
    stage("cleared the cache", null, "the store and the wrap are untouched");
    say("offline-ready", "Cache emptied — reload with the server up to refill it.");
  });
});

/**
 * Chrome's install prompt, captured rather than fired: the event arrives when
 * the browser decides the page qualifies, and `prompt()` needs a user gesture.
 * Keeping it behind a button is also the only way the spike can *report*
 * whether Chrome considered the page installable at all.
 */
let installPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as Event & { prompt: () => Promise<void> };
  show("install-row", true);
});

addEventListener("appinstalled", () => {
  show("install-row", false);
  stage("installed", null, "Chrome accepted the manifest — asking for durable storage again");
  void reportStorage();
});

document.getElementById("install")?.addEventListener("click", () => {
  void installPrompt?.prompt();
});

boot().catch(fail);
