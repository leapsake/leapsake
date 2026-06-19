import { open, seal, utf8ToBytes, bytesToUtf8 } from "@leapsake/crypto";
import { type Person, personSchema } from "@leapsake/schema";
import type { PeopleRepo } from "./people-repo.js";
import type {
  Cursor,
  EncryptedRecord,
  SyncTransport,
} from "./sync-transport.js";

/**
 * The client sync engine — the half that finally consumes both built pieces:
 * the `resolveMerge` LWW resolver (via the repo apply-path) and the encrypted
 * envelope (model.md §3). It seals locally-changed rows, pushes them over the
 * blind {@link SyncTransport}, pulls peers' records, decrypts, and applies them
 * through the repo (which merges). See plans/encryption/sync.md.
 *
 * This slice wires only the `people` table and seals each whole row **under the
 * master key directly** (`seal(json(row), MK)`); the per-record content-key
 * escalation stays an additive future (the unused `EncryptedRecord.wrappedKey`
 * slot). Sync-state watermarks are passed in and returned — the caller (a test
 * here, persistence later) holds them, so this slice needs no `sync_state`
 * table and no migration.
 */
export interface SyncEngine {
  /**
   * Seal and push every `people` row changed after `lastPushedUpdatedAt`
   * (including tombstones) and return the new high-water mark to pass next time.
   */
  push(lastPushedUpdatedAt: number): Promise<number>;
  /**
   * Pull records since `cursor`, decrypt, and apply each via the repo's merge,
   * returning the advanced cursor to pass next time.
   */
  pull(cursor: Cursor): Promise<Cursor>;
}

export function createSyncEngine(opts: {
  transport: SyncTransport;
  masterKey: Uint8Array;
  people: PeopleRepo;
}): SyncEngine {
  const { transport, masterKey, people } = opts;

  function toRecord(row: Person): EncryptedRecord {
    return {
      id: row.id,
      table: "people",
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      ciphertext: seal(utf8ToBytes(JSON.stringify(row)), masterKey),
    };
  }

  return {
    async push(lastPushedUpdatedAt) {
      const changed = await people.listChangedSince(lastPushedUpdatedAt);
      if (changed.length === 0) return lastPushedUpdatedAt;
      await transport.push(changed.map(toRecord));
      return changed.reduce(
        (hwm, row) => Math.max(hwm, row.updatedAt),
        lastPushedUpdatedAt,
      );
    },

    async pull(cursor) {
      const { records, cursor: next } = await transport.pull(cursor);
      for (const record of records) {
        if (record.table !== "people") continue;
        const row = personSchema.parse(
          JSON.parse(bytesToUtf8(open(record.ciphertext, masterKey))),
        );
        await people.upsertFromRemote(row);
      }
      return next;
    },
  };
}
