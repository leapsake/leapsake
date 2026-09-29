// The untrusted port sealed records cross: it never sees a key, a domain
// field or a merge. See the README's P2P invariants.

/** One encrypted row in flight; only {@link ciphertext} holds domain fields. */
export interface EncryptedRecord {
  /** The row's UUID — stable identity across devices. */
  id: string;
  /** Source table, such as `people`, which routes the record on apply. */
  table: string;
  /** Epoch ms; the LWW clock and a delivery-metadata floor (cleartext). */
  updatedAt: number;
  /** Epoch ms when soft-deleted, else null; a tombstone (cleartext). */
  deletedAt: number | null;
  /** `seal(utf8(JSON(row)), MK)`: the only place a domain field appears. */
  ciphertext: Uint8Array;
  /** Reserved: `wrap(CK, MK)` for a row sealed under its own content key. */
  wrappedKey?: Uint8Array;
}

/** The transport's own delivery order, never a content clock. */
export type Cursor = number;

export interface SyncTransport {
  /** Push locally-changed encrypted records to peers. */
  push(records: EncryptedRecord[]): Promise<void>;
  /** Pull records changed elsewhere since `since`, with the advanced cursor. */
  pull(since: Cursor): Promise<{ records: EncryptedRecord[]; cursor: Cursor }>;
}

/** An in-memory append log for tests, sequenced from 1, so a cursor of `0`
 *  pulls everything. */
export function createInMemoryTransport(): SyncTransport {
  const log: { seq: number; record: EncryptedRecord }[] = [];
  let seq = 0;

  return {
    async push(records) {
      for (const record of records) {
        seq += 1;
        log.push({ seq, record });
      }
    },

    async pull(since) {
      const pending = log.filter((entry) => entry.seq > since);
      const cursor =
        pending.length > 0 ? pending[pending.length - 1].seq : since;
      return { records: pending.map((entry) => entry.record), cursor };
    },
  };
}
