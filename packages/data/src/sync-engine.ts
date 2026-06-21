import { bytesToUtf8, open, seal, utf8ToBytes } from "@leapsake/crypto";
import type { SyncRow } from "@leapsake/schema";
import type { SyncStateRepo } from "./sync-state-repo.js";
import type { SyncableRepo } from "./syncable.js";
import type {
  Cursor,
  EncryptedRecord,
  SyncTransport,
} from "./sync-transport.js";

/**
 * The client sync engine — the half that finally consumes both built pieces:
 * the `resolveMerge` LWW resolver (via each repo's apply-path) and the encrypted
 * envelope (model.md §3). It seals locally-changed rows, pushes them over the
 * blind {@link SyncTransport}, pulls peers' records, decrypts, and applies them
 * through the owning repo (which merges). See plans/encryption/sync.md.
 *
 * The engine is **registry-driven**: it is handed a list of {@link SyncableRepo}
 * and routes each pulled record to the repo whose `table` it carries, so adding
 * an entity to sync is one more entry in the list — no engine change. Every row
 * is sealed **whole, under the master key directly** (`seal(json(row), MK)`); the
 * per-record content-key escalation stays an additive future (the unused
 * `EncryptedRecord.wrappedKey` slot).
 *
 * The two watermarks (the push high-water mark and the pull cursor) can either
 * be threaded by the caller through {@link SyncEngine.push}/{@link
 * SyncEngine.pull} — or, when a {@link SyncStateRepo} is supplied, persisted by
 * the engine itself via {@link SyncEngine.sync}, so a fresh engine on the same
 * database resumes where it left off.
 */
export interface SyncEngine {
  /**
   * Seal and push every row changed after `lastPushedUpdatedAt` (including
   * tombstones) across all registered repos, returning the new high-water mark
   * to pass next time. A single global mark suffices: `updated_at` is one clock
   * across every table and the transport is one append log.
   */
  push(lastPushedUpdatedAt: number): Promise<number>;
  /**
   * Pull records since `cursor`, decrypt, and apply each via its repo's merge,
   * returning the advanced `cursor` to pass next time and `applied` — the number
   * of records the relay delivered this batch. `applied > 0` is the "something
   * may have changed locally" signal reactive invalidation gates on; it is an
   * upper bound (the relay echoes the device's own pushed rows, which LWW-merge
   * to a no-op), so a redundant revalidate after your own push is possible but
   * harmless (loaders are idempotent).
   */
  pull(cursor: Cursor): Promise<{ cursor: Cursor; applied: number }>;
  /**
   * The self-driving loop: read both watermarks from the {@link SyncStateRepo},
   * {@link push} local changes then {@link pull} peers', and persist the
   * advanced marks. Push-first is conventional; correctness does not depend on
   * order (the merge is order-independent). Requires the engine to have been
   * built with a `syncState` repo — throws otherwise. Returns the pull's
   * `applied` count so a caller can gate UI revalidation on a changed pull.
   */
  sync(): Promise<{ applied: number }>;
}

export function createSyncEngine(opts: {
  transport: SyncTransport;
  masterKey: Uint8Array;
  repos: SyncableRepo<SyncRow>[];
  /**
   * Durable watermark store. Optional: omit it to thread marks manually via
   * `push`/`pull` (tests, back-compat); supply it to enable {@link
   * SyncEngine.sync}.
   */
  syncState?: SyncStateRepo;
}): SyncEngine {
  const { transport, masterKey, repos, syncState } = opts;
  const byTable = new Map(repos.map((repo) => [repo.table, repo]));

  function toRecord(table: string, row: SyncRow): EncryptedRecord {
    return {
      id: row.id,
      table,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      ciphertext: seal(utf8ToBytes(JSON.stringify(row)), masterKey),
    };
  }

  async function push(lastPushedUpdatedAt: number): Promise<number> {
    const records: EncryptedRecord[] = [];
    let hwm = lastPushedUpdatedAt;
    for (const repo of repos) {
      const changed = await repo.listChangedSince(lastPushedUpdatedAt);
      for (const row of changed) {
        records.push(toRecord(repo.table, row));
        hwm = Math.max(hwm, row.updatedAt);
      }
    }
    if (records.length > 0) await transport.push(records);
    return hwm;
  }

  async function pull(
    cursor: Cursor,
  ): Promise<{ cursor: Cursor; applied: number }> {
    const { records, cursor: next } = await transport.pull(cursor);
    // Apply order within a batch does not affect the converged state:
    // foreign-key enforcement is off and `upsertFromRemote` is LWW-idempotent,
    // so an edge that arrives before its endpoint still reconciles correctly.
    for (const record of records) {
      const repo = byTable.get(record.table);
      if (repo === undefined) continue; // unknown table — forward-compatible
      const row = repo.decode(
        JSON.parse(bytesToUtf8(open(record.ciphertext, masterKey))),
      );
      await repo.upsertFromRemote(row);
    }
    return { cursor: next, applied: records.length };
  }

  return {
    push,
    pull,

    async sync() {
      if (syncState === undefined) {
        throw new Error(
          "SyncEngine.sync() requires a `syncState` repo; build the engine " +
            "with one, or thread marks manually via push()/pull().",
        );
      }
      await syncState.setPushHwm(await push(await syncState.getPushHwm()));
      const { cursor, applied } = await pull(await syncState.getPullCursor());
      await syncState.setPullCursor(cursor);
      return { applied };
    },
  };
}
