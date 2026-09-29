import { bytesToUtf8, utf8ToBytes } from "@leapsake/bytes";
import { open, seal } from "@leapsake/crypto";
import type { SyncRow } from "@leapsake/schema";
import type { SyncStateRepo, SyncableRepo } from "@leapsake/data";
import type { Cursor, EncryptedRecord, SyncTransport } from "./transport.js";

/** Seals changed rows whole under the master key, pushes, pulls, decrypts
 *  and applies each through the repo its `table` names. */
export interface SyncEngine {
  /** Pushes every row, tombstones too, changed after the mark; returns the new
   *  one. One mark serves every table. */
  push(lastPushedUpdatedAt: number): Promise<number>;
  /** Pulls and applies records since `cursor`; `applied` counts those applied,
   *  an upper bound, as the relay echoes our own pushes. */
  pull(cursor: Cursor): Promise<{ cursor: Cursor; applied: number }>;
  /** Pushes then pulls on the stored watermarks and persists them; throws
   *  without a `syncState` repo. */
  sync(): Promise<{ applied: number }>;
}

export function createSyncEngine(opts: {
  transport: SyncTransport;
  masterKey: Uint8Array;
  repos: SyncableRepo<SyncRow>[];
  /** Where the watermarks persist; needed for {@link SyncEngine.sync}. */
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
    // Order doesn't matter: foreign keys are off and every apply is LWW.
    let applied = 0;
    for (const record of records) {
      const repo = byTable.get(record.table);
      if (repo === undefined) continue; // unknown table — forward-compatible
      // A bad record is skipped, not thrown, or the cursor would never pass it
      // and every later pull would stall; AEAD still fails closed.
      try {
        const row = repo.decode(
          JSON.parse(bytesToUtf8(open(record.ciphertext, masterKey))),
        );
        await repo.upsertFromRemote(row);
        applied += 1;
      } catch (err) {
        console.warn(
          `sync: skipping undecryptable/invalid record for table "${record.table}"`,
          err,
        );
      }
    }
    return { cursor: next, applied };
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
