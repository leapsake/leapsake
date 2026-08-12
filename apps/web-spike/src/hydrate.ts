import { DatabaseSync } from "node:sqlite";
import { type CoreApi, createCore, runMigrations, syncableRepos } from "@leapsake/core";
import { createHttpSyncTransport, createSyncEngine } from "@leapsake/sync";
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
  return {
    driver,
    transport,
    engine: createSyncEngine({
      transport,
      masterKey: session.masterKey,
      repos: syncableRepos(driver),
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
      const { transport, engine } = engineFor(session, existing.db);
      const pullStarted = performance.now();
      const pulled = await engine.pull(existing.cursor);
      existing.cursor = pulled.cursor;
      existing.lastUsed = Date.now();
      return {
        core: existing.core,
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
  const { driver, transport, engine } = engineFor(session, db);

  const pullStarted = performance.now();
  const pulled = await engine.pull(0);
  const pullMs = Math.round((performance.now() - pullStarted) * 10) / 10;

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
