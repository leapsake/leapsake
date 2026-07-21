/**
 * `@leapsake/sync` — the client half of V3 convergence, kept as its own unit so
 * the whole of "how rows leave and re-enter this device" is one package rather
 * than a concern split between the data layer and the composition root.
 *
 * Four pieces, in dependency order:
 *
 * - the {@link SyncTransport} **port** plus its in-memory test adapter — the
 *   seam over which already-sealed records move (plans/encryption/sync.md §1);
 * - {@link createHttpSyncTransport}, the authenticated blind-relay adapter;
 * - {@link createSyncEngine}, which seals locally-changed rows, pushes them,
 *   pulls peers' records, decrypts, and applies them through the owning repo;
 * - {@link createSyncScheduler}, the event-driven scheduling layer above the
 *   engine (debounced push kick, foreground pull trigger, interval backstop).
 *
 * It depends on `@leapsake/data` for **types only** — {@link SyncableRepo} (what
 * the engine routes to) and `SyncStateRepo` (where the watermarks live). Those
 * stay in `data` because `defineSyncable` is the primitive every repo is built
 * on and `sync_state` is an ordinary device-local table.
 *
 * Deliberately *not* here: `syncableRepos()` and the account join/recover/
 * register orchestration, which live in `@leapsake/core`. Deciding **what**
 * syncs means naming every repo, and that is composition-root work — pulling it
 * in would make this package depend on the entire entity surface it exists to
 * stay independent of.
 */
export {
  type Cursor,
  type EncryptedRecord,
  type SyncTransport,
  createInMemoryTransport,
} from "./transport.js";
export { type SyncEngine, createSyncEngine } from "./engine.js";
export {
  type AccountRegistration,
  type HttpSyncTransport,
  type WireRecord,
  createHttpSyncTransport,
  decodeRecord,
  encodeRecord,
} from "./http-transport.js";
export {
  type SyncScheduler,
  SYNC_INTERVAL_MS,
  SYNC_KICK_DEBOUNCE_MS,
  createSyncScheduler,
  withSyncKick,
} from "./scheduler.js";
