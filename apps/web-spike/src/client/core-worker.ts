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
import { bytesToUtf8 } from "@leapsake/bytes";
import { open } from "@leapsake/crypto";
import {
  createHttpSyncTransport,
  createSyncEngine,
  type EncryptedRecord,
  type SyncTransport,
} from "@leapsake/sync";
import { bootstrapMasterKey } from "../bootstrap.js";
import { eventLoopLag, instrumentTransport } from "../measure.js";
import { wasmSqliteDriver } from "../wasm-sqlite-driver.js";
import {
  type Canary,
  forgetCustody,
  loadCustody,
  peekCustody,
  pickCanary,
  saveCustody,
  storageStatus,
} from "./key-custody.js";
import type {
  Ready,
  Request,
  Response,
  ResumeSummary,
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
 * ## What Increment 5e added to it
 *
 * Two entry points beside `login`, and the shape of the module is the finding:
 * `resume()` reaches the same `openStore` + `createCore` the login does, having
 * skipped `lookup`, `deriveKeyMaterial`, `fetchBootstrap` and `pull` entirely.
 * The login's last act is `saveCustody`, which is what makes that possible —
 * the wrap is minted at the one moment this thread holds the master key, the
 * relay credential, and a record it can later prove itself against.
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
    // Increment 5e: whether a previous session left a wrap behind. Read without
    // unwrapping it, so the page can choose its form before anyone clicks.
    custody: await peekCustody(),
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

/**
 * Open the account's OPFS database and bring its schema up to date, reporting
 * the stage row either way.
 *
 * Shared by the password login and Increment 5e's warm start, which is the
 * cheap half of the finding: **a resume opens the same store the same way.**
 * The filename is the only thing it needs from the account, and custody carries
 * the account id for exactly that reason.
 */
async function openStore(accountId: string): Promise<{ existed: boolean }> {
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
  return { existed };
}

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

  const { existed } = await openStore(accountId);
  if (driver === undefined) throw new Error("the store did not open");

  // The durable watermarks the SSR host could not have (`sync-state-repo.ts`),
  // available here for exactly one reason: the store outlives the request. The
  // pull cursor is what makes the reload cheap, and it is the same `sync_state`
  // row desktop and mobile keep.
  const syncState = createSyncStateRepo(driver);
  const cursorBefore = await syncState.getPullCursor();

  const transport = instrumentTransport(
    createHttpSyncTransport({ baseUrl: "/relay", accountId, authVerifier }),
  );

  // Increment 5e's evidence, taken in passing: one record **exactly as the relay
  // sent it**, before the engine opens it. Kept in custody beside the wrapped
  // key so a warm start can open a ciphertext it did not produce — which is the
  // difference between proving the key round-trips and proving it is the
  // account's master key. Costs one `find` over a batch already in memory.
  let canary: Canary | null = null;
  const tapped: SyncTransport = {
    push: (records) => transport.push(records),
    pull: async (since) => {
      const result = await transport.pull(since);
      canary ??= pickCanary(result.records);
      return result;
    },
  };

  const engine = createSyncEngine({
    transport: tapped,
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

  // **Increment 5e**, and it is the last thing a login does: hand the next load
  // everything it needs to skip this whole function. A fresh non-extractable
  // `CryptoKey` in IndexedDB, the master key and the relay credential wrapped
  // under it, and the untouched relay record that will prove it came back right.
  const custody = await saveCustody({
    accountId,
    masterKey,
    authVerifier,
    canary,
  });
  // This thread can only *read* the storage bucket's state — `persist()` is
  // `[Exposed=Window]`, so the page asks (see `client-key-app.tsx`) and the
  // thread that owns the database merely reports what it got.
  const storage = await storageStatus();
  stage(
    "mint key custody",
    custody.ms,
    `non-extractable AES-GCM CryptoKey in IndexedDB — ${custody.extractability}; ${storage}`,
  );

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
    custody: { ms: custody.ms, extractability: custody.extractability, storage },
  };
}

// --- Increment 5e: the same client, started from the wrap ---------------------

/**
 * Run `fn` with `fetch` **removed from this thread**, counting anything that
 * tried to use it.
 *
 * The done-when says "with no password and no relay", and the password half is
 * structural — {@link resume} takes none. The relay half would otherwise be an
 * assertion about code nobody re-reads, so it is enforced instead: any `fetch`
 * during a resume throws, which fails the resume loudly rather than quietly
 * turning it back into a network login. (`fetch` is what `http-transport.ts`
 * uses; a `XMLHttpRequest` would slip past, and there is none in this graph.)
 */
async function withNoNetwork<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; calls: number; guardProven: boolean }> {
  const real = self.fetch;
  let calls = 0;
  self.fetch = ((...args: Parameters<typeof fetch>): never => {
    calls += 1;
    throw new Error(`resume tried to reach the network: ${String(args[0])}`);
  }) as typeof fetch;

  // The instrument checks itself before it is trusted, because "0 network calls"
  // and "the counter was never installed" look identical from the outside. One
  // deliberate probe, which must throw; it is the guard's own test, so it is not
  // counted as something the resume did.
  let guardProven = false;
  try {
    await self.fetch("/relay/this-request-must-not-be-possible");
  } catch {
    guardProven = true;
  }
  calls = 0;

  try {
    return { value: await fn(), calls, guardProven };
  } finally {
    self.fetch = real;
  }
}

/**
 * **The increment's done-when**: username and password → nothing. A wrap in
 * IndexedDB, a database in OPFS, and a rendered person.
 *
 * What it does *not* do is the interesting list: no `lookup`, no
 * `deriveKeyMaterial`, no `fetchBootstrap`, no `pull`. 5c left the store, the
 * schema and the sync cursor surviving a reload and the key alone not surviving,
 * so this is the whole remaining gap closed — and the cost of the warm start
 * drops from an Argon2id to an `AES-GCM` decrypt of 32 bytes.
 *
 * The account's `authVerifier` comes back out of custody too, unused here on
 * purpose: this path proves the *offline* claim, and a resumed session that
 * wants to sync has the credential waiting (see the page's "sync now").
 */
async function resume(): Promise<ResumeSummary> {
  const startedAt = performance.now();

  const { value, calls, guardProven } = await withNoNetwork(async () => {
    const unwrapStarted = performance.now();
    const custody = await loadCustody();
    if (custody === null) throw new Error("no custody wrap in IndexedDB");
    const unwrapMs = round(performance.now() - unwrapStarted);
    stage(
      "unwrap the master key",
      unwrapMs,
      `IndexedDB → non-extractable CryptoKey → AES-GCM → ${custody.masterKey.length}-byte ` +
        `master key and ${custody.authVerifier.length}-byte relay verifier; ` +
        `${custody.extractability}`,
    );

    const openStarted = performance.now();
    await openStore(custody.accountId);
    if (driver === undefined) throw new Error("the store did not open");
    const openStoreMs = round(performance.now() - openStarted);

    const coreStarted = performance.now();
    core = createCore(driver);
    const entities = await core.views.entityList();
    const people = entities
      .filter((row) => row.type === "person")
      .map((row) => ({ id: row.id, label: row.label }));
    stage("createCore + entityList", round(performance.now() - coreStarted), "");

    // The proof, and the reason a canary was kept at mint time: this ciphertext
    // was produced by the account's real master key, elsewhere, and arrived over
    // the wire. Opening it with the key that came out of IndexedDB is the claim
    // "custody returned the account's master key" in its strongest cheap form —
    // a self-sealed value would only have proven AES-GCM is symmetric.
    let opened: ResumeSummary["canary"] = null;
    if (custody.canary !== null) {
      const row = JSON.parse(bytesToUtf8(open(custody.canary.ciphertext, custody.masterKey))) as
        Record<string, unknown>;
      const label =
        typeof row.firstName === "string"
          ? `${row.firstName} ${String(row.lastName ?? "")}`.trim()
          : JSON.stringify(row).slice(0, 60);
      opened = {
        table: custody.canary.table,
        id: custody.canary.id,
        plaintext: label,
        bytes: custody.canary.ciphertext.byteLength,
        inStore: people.some((person) => person.id === custody.canary?.id),
      };
      stage(
        "open a relay record with it",
        null,
        `${opened.bytes} B of ciphertext from ${opened.table} → “${opened.plaintext}”` +
          `${opened.inStore ? ", the same row the OPFS store holds" : " — not in the store"}`,
      );
    }

    return {
      accountId: custody.accountId,
      people,
      unwrapMs,
      openStoreMs,
      mintedAt: custody.mintedAt,
      extractability: custody.extractability,
      canary: opened,
    };
  });

  return {
    ...value,
    networkCalls: calls,
    guardProven,
    totalMs: round(performance.now() - startedAt),
  };
}

/** The logout half of custody: drop the wrap, keep the store. */
async function forget(): Promise<string> {
  await forgetCustody();
  return "the wrap is gone — the next load needs the password again";
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

/**
 * Throw the OPFS store away, so the next load is a cold one again — **and the
 * custody wrap with it**, because a wrap without a store is a warm start into an
 * empty database: it would open, migrate a fresh schema, and render nobody.
 * "Cold" has meant the store since 5c; since 5e it means the key too.
 */
async function wipe(): Promise<string[]> {
  db?.close();
  db = undefined;
  driver = undefined;
  core = undefined;
  await poolUtil.wipeFiles();
  await forgetCustody();
  return poolUtil.getFileNames();
}

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  const run = async (): Promise<unknown> => {
    switch (request.kind) {
      case "login":
        return login(request.username, request.password);
      case "resume":
        return resume();
      case "forget":
        return forget();
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
