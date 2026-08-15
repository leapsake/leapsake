/**
 * The sync transport port — the seam over which already-encrypted records move
 * between this device and its peers.
 *
 * Like {@link SqliteDriver} and the crypto `KeyStore`, the transport is an
 * *untrusted, swappable* port: content is sealed **before** it crosses this
 * line (per-item / per-row keys, plans/encryption/model.md §3), so the
 * transport never sees plaintext, never holds a key, and never merges.
 * Everything it carries is ciphertext plus sync metadata (UUIDs, `updatedAt`,
 * `deletedAt`) — never a domain field. That is exactly what keeps the relay
 * blind and a future P2P transport possible (README.md → *What must stay true
 * for P2P*).
 *
 * Two adapters implement it: {@link createInMemoryTransport} here for tests,
 * and the authenticated HTTPS blind-relay adapter in `http-transport.ts`.
 */

/**
 * One encrypted row in flight. The domain fields live **only** inside
 * {@link ciphertext}; everything else is the cleartext sync metadata the
 * transport is allowed to see and order by.
 */
export interface EncryptedRecord {
  /** The row's UUID — stable identity across devices. */
  id: string;
  /** Source table, e.g. `'people'` — routes the record to a repo on apply. */
  table: string;
  /** Epoch ms; the LWW clock and a delivery-metadata floor (cleartext). */
  updatedAt: number;
  /** Epoch ms when soft-deleted, else null; a tombstone (cleartext). */
  deletedAt: number | null;
  /** `seal(utf8(JSON(row)), MK)` — the only place a domain field appears. */
  ciphertext: Uint8Array;
  /**
   * RESERVED and unused so far. When a row escalates to a per-record content
   * key (plans/encryption/model.md §3), this carries `wrap(CK, MK)` and the ciphertext
   * is sealed under CK instead of MK — an *additive* change, no reshaping.
   */
  wrappedKey?: Uint8Array;
}

/**
 * An opaque delivery cursor. It is the **transport's** own ordering of
 * delivery, deliberately *not* a content `updatedAt` — so we never depend on a
 * server-authoritative clock (the P2P invariant, README.md).
 */
export type Cursor = number;

export interface SyncTransport {
  /** Push locally-changed encrypted records to peers. */
  push(records: EncryptedRecord[]): Promise<void>;
  /** Pull records changed elsewhere since `since`, with the advanced cursor. */
  pull(since: Cursor): Promise<{ records: EncryptedRecord[]; cursor: Cursor }>;
}

/**
 * An in-memory {@link SyncTransport} for tests: an append log with a monotonic
 * sequence. `push` appends each record tagged with the next sequence number;
 * `pull(since)` returns every record appended after `since` plus the new
 * high-water sequence. The sequence orders *delivery* only — it is independent
 * of any content clock, the same property the real relay must have.
 *
 * A starting cursor of `0` pulls the whole log (sequences start at 1).
 */
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
