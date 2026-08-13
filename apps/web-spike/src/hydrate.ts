import { DatabaseSync } from "node:sqlite";
import { type CoreApi, createCore, runMigrations, syncableRepos } from "@leapsake/core";
import {
  createHttpSyncTransport,
  createSyncEngine,
  type SyncEngine,
} from "@leapsake/sync";
import { instrumentTransport, type TransportStats } from "./measure.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";
import type { OpenSession } from "./session.js";

/**
 * Turn an open session into a `core` to render from — **where the decrypted store
 * lives, as a measurement rather than a preference** (spike doc → *Two design
 * points*).
 *
 * ## The configuration this defaults to, and why it changed
 *
 * The plan doc's decision rule assumed the *pull* was the expense, so it proposed
 * warm-per-session as the default. Increment 1 measured otherwise: Argon2id is
 * ~355 ms at every store size and the whole pull+decrypt of a 10 000-row account
 * is less than the login preceding it. So the configuration to measure first is
 * **warm key, cold store** — which is not a compromise between the two, it is
 * §9.2 exactly as written:
 *
 * - the *key* is warm because `session.ts` holds `wrap(MK, sk)` across requests,
 *   so the KDF runs once per login and never again;
 * - the *store* is cold because this builds a fresh in-memory database per
 *   request and discards it, which is the "memory-only, request-scoped, zeroized"
 *   half that a warm decrypted store violates.
 *
 * If that measures acceptably, the §9.2 conflict dissolves without anyone having
 * to defend holding users' decrypted data in server memory. `WEB_SPIKE_STORE=warm`
 * builds the other arm for comparison, and its docblock states what it costs.
 *
 * ## The boot-time template
 *
 * `runMigrations` on every request would measure the migration runner rather than
 * the store. `node:sqlite`'s `DatabaseSync` exposes `serialize()`/`deserialize()`,
 * so the schema is built **once at boot** and each request deserializes those
 * bytes — the nearly-free optimization the spike doc flags, with the number it
 * saves reported per request.
 */

export type StoreMode = "cold" | "warm";

export const storeMode: StoreMode =
  process.env.WEB_SPIKE_STORE === "warm" ? "warm" : "cold";

/** How long a warm store survives without a request, before it is discarded. */
const WARM_IDLE_MS = 5 * 60 * 1000;

export interface HydrateTimings {
  mode: StoreMode;
  /** Building the empty schema: template deserialize, or a cold `runMigrations`. */
  storeMs: number;
  /** `pull` wall time, transport included. */
  pullMs: number;
  /** The wire half of `pullMs`; `pullMs - transportMs` is decrypt + apply. */
  transportMs: number;
  records: number;
  bytes: number;
  applied: number;
  /** Everything above, plus `createCore` — what the route waited for. */
  totalMs: number;
  /** True when a warm store served this request without rebuilding. */
  reused: boolean;
}

export interface Hydrated {
  core: CoreApi;
  /**
   * The same engine that pulled this store, kept so a write can push it back.
   *
   * Increment 3's whole point is that the round trip closes, and a cold store
   * makes that unfakeable: the next request throws this database away and
   * re-pulls, so a write that was not pushed does not merely fail to reach a
   * peer — it vanishes from the web client too.
   */
  engine: SyncEngine;
  /**
   * The instrumented transport's running totals. Read before and after a push
   * to get the push's own record count and wire bytes — `timings` below is a
   * snapshot taken at the end of the pull, so it cannot carry them.
   */
  transportStats: () => TransportStats;
  /**
   * The highest `updated_at` in the store the instant the pull finished — the
   * correct starting mark for this request's push, and the fix for a bug
   * Increment 3 measured.
   *
   * `SyncEngine.push(hwm)` re-seals and re-pushes every row with
   * `updated_at > hwm`. Desktop keeps `hwm` in a durable `sync_state` row, so
   * it only ever pushes what it actually changed. A cold host has no durable
   * row, and starting from 0 — the obvious substitute, and what the plan doc
   * prescribed — makes a session's *first* write re-push the entire store,
   * permanently: the relay is an append-only log with no compaction, so those
   * ~150 duplicate versions are re-pulled by every later request of every later
   * session (README finding 3).
   *
   * A cold store can close that with no durable state, because it has a
   * property desktop's does not: **everything in it arrived from the relay
   * moments ago, in this very request.** So the boundary between "pulled" and
   * "written by this request" is exactly the store's own high-water mark.
   *
   * **Not `Date.now()`, which is the trap.** The obvious spelling of the same
   * idea is a wall-clock timestamp taken after the pull — and it silently drops
   * writes. `listChangedSince` is `updated_at > ?`, strictly, at millisecond
   * resolution, and a create landing in the mark's own millisecond compares
   * equal and is skipped. Measured: with a clock mark, four writes out of five
   * pushed **zero records** while still returning a happy 303. Reading the mark
   * out of the store is the same query the engine would have run, so it cannot
   * disagree with it.
   */
  pushMark: number;
  timings: HydrateTimings;
  /** Release the store. A no-op for a warm one, which outlives the request. */
  release(): void;
}

/**
 * The migrated-but-empty database, serialized once. Built lazily on the first
 * hydrate rather than at import, so a boot failure lands on a request with a
 * stack rather than on a module graph.
 */
let template: Uint8Array | null = null;

async function emptyStore(): Promise<{ db: DatabaseSync; ms: number }> {
  const started = performance.now();
  const db = new DatabaseSync(":memory:");
  if (template === null) {
    await runMigrations(nodeSqliteDriver(db));
    template = db.serialize();
  } else {
    db.deserialize(template);
  }
  return { db, ms: Math.round((performance.now() - started) * 10) / 10 };
}

interface WarmEntry {
  db: DatabaseSync;
  core: CoreApi;
  /** The high-water mark the next delta pull resumes from. */
  cursor: number;
  lastUsed: number;
}

const warm = new Map<string, WarmEntry>();

function sweepWarm(): void {
  const cutoff = Date.now() - WARM_IDLE_MS;
  for (const [id, entry] of warm) {
    if (entry.lastUsed < cutoff) {
      entry.db.close();
      warm.delete(id);
    }
  }
}

/**
 * The highest `updated_at` across every synced table — see `Hydrated.pushMark`.
 *
 * One `UNION ALL` rather than 24 round trips, and it leans on two facts about
 * `defineSyncable`: a repo's `table` **is** its SQL table name, and the column
 * `listChangedSince` filters on is `updated_at` on every one of them. If either
 * ever stops being true this returns a wrong mark rather than failing, which is
 * the argument for `SyncEngine` exposing this itself — logged in
 * `WANTED-CHANGES.md`.
 */
async function storeMark(
  driver: ReturnType<typeof nodeSqliteDriver>,
  tables: readonly string[],
): Promise<number> {
  const union = tables
    .map((table) => `SELECT MAX(updated_at) AS m FROM ${table}`)
    .join(" UNION ALL ");
  const row = await driver.get<{ m: number | null }>(
    `SELECT MAX(m) AS m FROM (${union})`,
  );
  return row?.m ?? 0;
}

/** Everything a pull needs, built from the request's own key material. */
function engineFor(session: OpenSession, db: DatabaseSync) {
  const driver = nodeSqliteDriver(db);
  const transport = instrumentTransport(
    createHttpSyncTransport({
      baseUrl: session.relayUrl,
      accountId: session.accountId,
      authVerifier: session.authVerifier,
    }),
  );
  const repos = syncableRepos(driver);
  return {
    driver,
    transport,
    tables: repos.map((repo) => repo.table),
    engine: createSyncEngine({
      transport,
      masterKey: session.masterKey,
      repos,
    }),
  };
}

function timings(opts: {
  storeMs: number;
  pullMs: number;
  applied: number;
  stats: TransportStats;
  startedAt: number;
  reused: boolean;
}): HydrateTimings {
  return {
    mode: storeMode,
    storeMs: opts.storeMs,
    pullMs: opts.pullMs,
    transportMs: opts.stats.transportMs,
    records: opts.stats.records,
    bytes: opts.stats.bytes,
    applied: opts.applied,
    totalMs: Math.round((performance.now() - opts.startedAt) * 10) / 10,
    reused: opts.reused,
  };
}

export async function hydrate(session: OpenSession): Promise<Hydrated> {
  const startedAt = performance.now();

  if (storeMode === "warm") {
    sweepWarm();
    const existing = warm.get(session.id);
    if (existing !== undefined) {
      // The delta, not the account: this is the whole reason warm is cheaper.
      const { transport, engine, tables } = engineFor(session, existing.db);
      const pullStarted = performance.now();
      const pulled = await engine.pull(existing.cursor);
      const pushMark = await storeMark(nodeSqliteDriver(existing.db), tables);
      existing.cursor = pulled.cursor;
      existing.lastUsed = Date.now();
      return {
        core: existing.core,
        engine,
        transportStats: transport.stats,
        pushMark,
        timings: timings({
          storeMs: 0,
          pullMs: Math.round((performance.now() - pullStarted) * 10) / 10,
          applied: pulled.applied,
          stats: transport.stats(),
          startedAt,
          reused: true,
        }),
        release: () => {},
      };
    }
  }

  const { db, ms: storeMs } = await emptyStore();
  const { driver, transport, engine, tables } = engineFor(session, db);

  const pullStarted = performance.now();
  const pulled = await engine.pull(0);
  const pullMs = Math.round((performance.now() - pullStarted) * 10) / 10;
  const pushMark = await storeMark(driver, tables);

  const core = createCore(driver);

  if (storeMode === "warm") {
    warm.set(session.id, {
      db,
      core,
      cursor: pulled.cursor,
      lastUsed: Date.now(),
    });
  }

  return {
    core,
    engine,
    transportStats: transport.stats,
    pushMark,
    timings: timings({
      storeMs,
      pullMs,
      applied: pulled.applied,
      stats: transport.stats(),
      startedAt,
      reused: false,
    }),
    // Cold's whole claim is that nothing decrypted outlives the response, and
    // this line is that claim. A `:memory:` database's pages are native memory,
    // so leaving it to the GC would keep a fully decrypted store alive for an
    // unbounded time — invisible in `heapUsed`, and exactly the property §9.2
    // promises against.
    release: storeMode === "warm" ? () => {} : () => db.close(),
  };
}

/** How many warm stores are resident — the RSS measurement's denominator. */
export function warmCount(): number {
  return warm.size;
}
