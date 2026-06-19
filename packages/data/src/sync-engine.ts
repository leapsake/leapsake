import { bytesToUtf8, open, seal, utf8ToBytes } from "@leapsake/crypto";
import type { SyncRow } from "@leapsake/schema";
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
 * `EncryptedRecord.wrappedKey` slot). Sync-state watermarks are passed in and
 * returned — the caller (a test here, persistence later) holds them, so this
 * still needs no `sync_state` table and no migration.
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
   * returning the advanced cursor to pass next time.
   */
  pull(cursor: Cursor): Promise<Cursor>;
}

export function createSyncEngine(opts: {
  transport: SyncTransport;
  masterKey: Uint8Array;
  repos: SyncableRepo<SyncRow>[];
}): SyncEngine {
  const { transport, masterKey, repos } = opts;
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

  return {
    async push(lastPushedUpdatedAt) {
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
    },

    async pull(cursor) {
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
      return next;
    },
  };
}
