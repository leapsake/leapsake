import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { EncryptedRecord } from "@leapsake/data";

/**
 * The blind relay's own store — *not* the app's domain schema (plans/encryption/
 * sync.md §2). It holds two things and nothing more:
 *
 * - `relay_account` — per account: a *hash* of the auth verifier (never the
 *   verifier itself) plus the public KDF salt. The hash is all the relay needs
 *   to authenticate; a leak of it does not expose the KEK (model.md §9.3).
 * - `relay_record` — the append log of opaque {@link EncryptedRecord}s. The
 *   autoincrement `seq` *is* the delivery cursor — the relay's own ordering,
 *   never a content clock (the P2P invariant, sync.md §3 #2).
 *
 * It is deliberately trivial: a blind blob store can be, because the envelope
 * does the hard work. It uses `node:sqlite` directly — there is no domain
 * `SqliteDriver` here to reuse, and nothing portable to keep.
 */

export interface RelayAccount {
  authVerifierHash: Uint8Array;
  kdfSalt: Uint8Array;
}

export interface RelayStore {
  /** Idempotent: registering an existing account is a no-op (keeps the first). */
  registerAccount(
    accountId: string,
    authVerifierHash: Uint8Array,
    kdfSalt: Uint8Array,
  ): void;
  getAccount(accountId: string): RelayAccount | undefined;
  /** Append records to one account's blind log, each taking the next `seq`. */
  append(accountId: string, records: EncryptedRecord[]): void;
  /** Records for this account with `seq > since`, plus the advanced cursor. */
  pull(
    accountId: string,
    since: number,
  ): { records: EncryptedRecord[]; cursor: number };
}

/** node:sqlite hands BLOBs back as a Buffer; normalize to a plain Uint8Array. */
function bytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

interface RecordRow {
  seq: number;
  id: string;
  table_name: string;
  updated_at: number;
  deleted_at: number | null;
  ciphertext: Uint8Array;
  wrapped_key: Uint8Array | null;
}

export function createRelayStore(db: DatabaseSync): RelayStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS relay_account (
      account_id         TEXT PRIMARY KEY,
      auth_verifier_hash BLOB NOT NULL,
      kdf_salt           BLOB NOT NULL,
      created_at         INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS relay_record (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id  TEXT NOT NULL,
      id          TEXT NOT NULL,
      table_name  TEXT NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER,
      ciphertext  BLOB NOT NULL,
      wrapped_key BLOB
    );
    CREATE INDEX IF NOT EXISTS relay_record_account_seq
      ON relay_record (account_id, seq);
  `);

  return {
    registerAccount(accountId, authVerifierHash, kdfSalt) {
      db.prepare(
        `INSERT INTO relay_account
           (account_id, auth_verifier_hash, kdf_salt, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(account_id) DO NOTHING`,
      ).run(
        accountId,
        authVerifierHash as SQLInputValue,
        kdfSalt as SQLInputValue,
        Date.now(),
      );
    },

    getAccount(accountId) {
      const row = db
        .prepare(
          "SELECT auth_verifier_hash, kdf_salt FROM relay_account WHERE account_id = ?",
        )
        .get(accountId) as
        | { auth_verifier_hash: Uint8Array; kdf_salt: Uint8Array }
        | undefined;
      if (row === undefined) return undefined;
      return {
        authVerifierHash: bytes(row.auth_verifier_hash),
        kdfSalt: bytes(row.kdf_salt),
      };
    },

    append(accountId, records) {
      const insert = db.prepare(
        `INSERT INTO relay_record
           (account_id, id, table_name, updated_at, deleted_at, ciphertext, wrapped_key)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const record of records) {
        insert.run(
          accountId,
          record.id,
          record.table,
          record.updatedAt,
          record.deletedAt,
          record.ciphertext as SQLInputValue,
          (record.wrappedKey ?? null) as SQLInputValue,
        );
      }
    },

    pull(accountId, since) {
      const rows = db
        .prepare(
          `SELECT seq, id, table_name, updated_at, deleted_at, ciphertext, wrapped_key
             FROM relay_record
            WHERE account_id = ? AND seq > ?
            ORDER BY seq`,
        )
        .all(accountId, since) as unknown as RecordRow[];

      const records: EncryptedRecord[] = rows.map((row) => {
        const record: EncryptedRecord = {
          id: row.id,
          table: row.table_name,
          updatedAt: row.updated_at,
          deletedAt: row.deleted_at,
          ciphertext: bytes(row.ciphertext),
        };
        if (row.wrapped_key !== null)
          record.wrappedKey = bytes(row.wrapped_key);
        return record;
      });

      const cursor = rows.length > 0 ? rows[rows.length - 1].seq : since;
      return { records, cursor };
    },
  };
}
