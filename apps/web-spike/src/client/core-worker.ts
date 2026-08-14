/// <reference lib="webworker" />
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Database, SAHPoolUtil, Sqlite3Static } from "@sqlite.org/sqlite-wasm";
import {
  type CoreApi,
  createCore,
  runMigrations,
  syncableRepos,
} from "@leapsake/core";
import { createSyncStateRepo, type SqliteDriver } from "@leapsake/data";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
import { bootstrapMasterKey } from "../bootstrap.js";
import { eventLoopLag, instrumentTransport } from "../measure.js";
import { wasmSqliteDriver } from "../wasm-sqlite-driver.js";
import type {
  Ready,
  Request,
  Response,
  Stage,
  Summary,
} from "./worker-protocol.js";

/**
 * **Increment 5c**: everything 5b ran in the tab, moved one thread over.
 *
 * The whole of the client's data layer lives in this module and never leaves it
 * — sqlite-wasm, the OPFS database, Argon2id, the master key, `createSyncEngine`
 * and `createCore` — and the main thread gets a `postMessage` proxy onto
 * `CoreApi` (`core-proxy.ts`) plus a stream of stage rows. Nothing about
 * `packages/` knows this happened; a seventh increment with zero edits under it.
 *
 * ## Why the split lands exactly here
 *
 * The main/renderer split desktop already has, spelled with a different RPC:
 * `window.api.people.get(id)` is `ipcRenderer.invoke("people.get", id)`, and
 * here it is `postMessage({ path: ["people", "get"], args: [id] })`. `CoreApi`
 * is all-async, so the boundary needs no reshaping in either direction — which
 * is why the *screen* (`person-app.tsx`) is a shared file rather than a port.
 *
 * ## Two reasons, and they are different reasons
 *
 * 1. **Argon2id.** 5b measured it at 450–850 ms of a ~1 s login, with the tab
 *    frozen for essentially all of it. A worker does not make it cheaper — that
 *    is 5e's question — it makes it *someone else's thread*, so the page can
 *    paint, animate and accept input throughout. The page proves that rather
 *    than asserting it: it runs a frame meter and an input on the main thread
 *    while this one blocks.
 * 2. **OPFS.** `installOpfsSAHPoolVfs()` needs synchronous access handles, and
 *    those are worker-only in every browser that has them. So persistence was
 *    never available to 5b's design at all: the two halves of this increment are
 *    one decision, not two.
 *
 * ## The database is named after the account
 *
 * `/spike-<accountId>.db`, decided *after* the login rather than before it. A
 * persistent store plus a login form is a mismatch waiting to happen — log in as
 * a second account against a store holding the first one's rows and the sync
 * engine will merrily merge two accounts into one file. Deriving the filename
 * from the account id makes that impossible for free, and costs nothing because
 * `lookup(username)` yields the id before any store is opened. (A real client
 * has one account per install and answers this with custody instead — §13.)
 */

const post = (message: Ready | Stage | Response): void => {
  self.postMessage(message);
};

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function stage(label: string, ms: number | null, detail = ""): void {
  post({ kind: "stage", label, ms, detail });
}

// --- The engine and the VFS, both paid before the user has typed -------------

/**
 * Engine init and the OPFS pool are the two fixed costs 5a and 5b measured on
 * the login path (~27 ms and, in `:memory:`, nothing). Here the worker starts
 * with the page, so both are paid while the login form sits idle — the first
 * thing the split buys, and it costs nothing but *when* the work is started.
 */
const bootStarted = performance.now();
let sqlite3: Sqlite3Static;
let poolUtil: SAHPoolUtil;
try {
  sqlite3 = await sqlite3InitModule({ print: console.log, printErr: console.error });
  const initMs = round(performance.now() - bootStarted);

  const vfsStarted = performance.now();
  // Default capacity is 6 files, which the docs put at "one or two databases and
  // their journals" — one database here. `clearOnInit` stays off: surviving a
  // reload is the increment's second done-when.
  poolUtil = await sqlite3.installOpfsSAHPoolVfs({ name: "leapsake-spike" });
  post({
    kind: "ready",
    initMs,
    vfsMs: round(performance.now() - vfsStarted),
    libVersion: sqlite3.version.libVersion,
    vfsName: poolUtil.vfsName,
    files: poolUtil.getFileNames(),
  });
} catch (error) {
  // The two ways this fails are worth telling apart in the page, because one of
  // them is a product finding rather than a bug: a **second tab** cannot install
  // the pool at all, since the first tab's worker holds every sync access handle
  // exclusively. The other is a browser without OPFS.
  post({ kind: "ready", error: String(error) });
  throw error;
}

// --- What the login builds, and the RPC then talks to ------------------------

let db: Database | undefined;
let driver: SqliteDriver | undefined;
let core: CoreApi | undefined;

async function login(username: string, password: string): Promise<Summary> {
  const startedAt = performance.now();

  // The same probe 5b ran on the main thread, now measuring *this* thread — so
  // the finding is not "the stall vanished" (it did not, and could not) but
  // "the stall is here, where nothing is painting". The page runs its own meter
  // on its own thread and the two numbers are meant to be read as a pair.
  const lag = eventLoopLag();

  // `bootstrap.ts` again, unmodified: the module the SSR host logs in with, run
  // in a Worker this time. Third host, same four calls.
  const { accountId, masterKey, authVerifier, argon2Ms, argon2LagMs } =
    await bootstrapMasterKey({ relayUrl: "/relay", username, password });
  stage(
    "Argon2id + bootstrap",
    argon2Ms,
    `worker thread stalled ${argon2LagMs} ms — 19 MiB, t=2, in JavaScript`,
  );

  const filename = `/spike-${accountId}.db`;
  const existed = poolUtil.getFileNames().includes(filename);

  const openStarted = performance.now();
  db = new poolUtil.OpfsSAHPoolDb(filename);
  driver = wasmSqliteDriver(db);
  const before = await driver.get<{ user_version: number }>("PRAGMA user_version");
  await runMigrations(driver);
  const after = await driver.get<{ user_version: number }>("PRAGMA user_version");
  stage(
    "open OPFS + runMigrations",
    round(performance.now() - openStarted),
    existed
      ? `${filename} — schema already at ${before?.user_version ?? 0}, nothing to do`
      : `${filename} — new file, migrated 0 → ${after?.user_version ?? 0}`,
  );

  // The durable watermarks the SSR host could not have (`sync-state-repo.ts`),
  // available here for exactly one reason: the store outlives the request. The
  // pull cursor is what makes the reload cheap, and it is the same `sync_state`
  // row desktop and mobile keep.
  const syncState = createSyncStateRepo(driver);
  const cursorBefore = await syncState.getPullCursor();

  const transport = instrumentTransport(
    createHttpSyncTransport({ baseUrl: "/relay", accountId, authVerifier }),
  );
  const engine = createSyncEngine({
    transport,
    masterKey,
    repos: syncableRepos(driver),
    syncState,
  });

  const pullStarted = performance.now();
  const pulled = await engine.pull(cursorBefore);
  await syncState.setPullCursor(pulled.cursor);
  const pullMs = round(performance.now() - pullStarted);
  const stats = transport.stats();
  stage(
    `pull(${cursorBefore}) + decrypt + apply`,
    pullMs,
    `${pulled.applied} applied / ${stats.records} records / ` +
      `${(stats.bytes / 1024).toFixed(1)} KiB — transport ${stats.transportMs} ms, ` +
      `decrypt + apply ${round(pullMs - stats.transportMs)} ms → cursor ${pulled.cursor}`,
  );

  const coreStarted = performance.now();
  core = createCore(driver);
  const entities = await core.views.entityList();
  const people = entities
    .filter((row) => row.type === "person")
    .map((row) => ({ id: row.id, label: row.label }));
  stage("createCore + entityList", round(performance.now() - coreStarted), "");

  return {
    people,
    totalMs: round(performance.now() - startedAt),
    argon2Ms,
    workerLagMs: await lag.stop(),
    argon2LagMs,
    cursorBefore,
    cursorAfter: pulled.cursor,
    applied: pulled.applied,
    records: stats.records,
    reusedStore: existed,
  };
}

/**
 * One `CoreApi` call, addressed by the path the main thread walked on its proxy.
 *
 * The parent object is kept as `this` so a method written against its siblings
 * behaves identically to a direct call — nothing in `createCore` needs it today
 * (every method is a closure), and relying on that would make the proxy a
 * different thing from the API it stands in for.
 */
async function call(path: readonly string[], args: unknown[]): Promise<unknown> {
  if (core === undefined) throw new Error("not logged in");
  let parent: unknown = undefined;
  let target: unknown = core;
  for (const key of path) {
    if (target === null || typeof target !== "object") {
      throw new Error(`core.${path.join(".")} is not callable`);
    }
    parent = target;
    target = (target as Record<string, unknown>)[key];
  }
  if (typeof target !== "function") {
    throw new Error(`core.${path.join(".")} is not a function`);
  }
  return (target as (...a: unknown[]) => unknown).apply(parent, args);
}

/** Throw the OPFS store away, so the next load is a cold one again. */
async function wipe(): Promise<string[]> {
  db?.close();
  db = undefined;
  driver = undefined;
  core = undefined;
  await poolUtil.wipeFiles();
  return poolUtil.getFileNames();
}

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  const run = async (): Promise<unknown> => {
    switch (request.kind) {
      case "login":
        return login(request.username, request.password);
      case "call":
        return call(request.path, request.args);
      case "wipe":
        return wipe();
    }
  };
  run().then(
    (value) => {
      post({ kind: "response", id: request.id, ok: true, value });
    },
    (error: unknown) => {
      // Errors do not survive `postMessage` as anything useful (a DOMException
      // clone loses its cause, and `SQLite3Error` is not cloneable at all), so
      // the wire carries a string and the proxy re-throws it on the other side.
      post({ kind: "response", id: request.id, ok: false, error: String(error) });
    },
  );
});
