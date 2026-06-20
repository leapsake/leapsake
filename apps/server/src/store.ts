import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { EncryptedRecord } from "@leapsake/data";

/**
 * The blind relay's own store — *not* the app's domain schema (plans/encryption/
 * sync.md §2). It holds two things and nothing more:
 *
 * - `relay_account` — per account: a *hash* of the auth verifier (never the
 *   verifier itself), the public KDF salt, a unique `username`, and the
 *   *ciphertext* `wrap(MK, password-KEK)` (the "protected symmetric key").
 *   The hash is all the relay needs to authenticate; a leak of it does not
 *   expose the KEK (model.md §9.3), and the wrapped master key is opaque
 *   ciphertext — the relay stores it for a second device to fetch and unwrap,
 *   but can never read it (multi-device-login.md).
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
  /** Ciphertext `wrap(MK, KEK)` — opaque to the relay (multi-device-login.md). */
  wrappedMasterKey: Uint8Array;
}

/** Outcome of {@link RelayStore.registerAccount}, mapped to an HTTP status. */
export type RegisterResult = "created" | "exists" | "username-taken";

export interface RelayStore {
  /**
   * Register an account. Idempotent on `accountId` (re-registering the same id is
   * a no-op that keeps the first → `"exists"`). A `username` already held by a
   * *different* account is rejected (`"username-taken"` → 409). Otherwise inserts
   * and returns `"created"`.
   */
  registerAccount(
    accountId: string,
    username: string,
    authVerifierHash: Uint8Array,
    kdfSalt: Uint8Array,
    wrappedMasterKey: Uint8Array,
  ): RegisterResult;
  getAccount(accountId: string): RelayAccount | undefined;
  /** Prelogin: resolve a username to its account id + public salt, or undefined. */
  getAccountByUsername(
    username: string,
  ): { accountId: string; kdfSalt: Uint8Array } | undefined;
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
      username           TEXT NOT NULL UNIQUE,
      auth_verifier_hash BLOB NOT NULL,
      kdf_salt           BLOB NOT NULL,
      wrapped_master_key BLOB NOT NULL,
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

  const getAccount = (accountId: string): RelayAccount | undefined => {
    const row = db
      .prepare(
        "SELECT auth_verifier_hash, kdf_salt, wrapped_master_key FROM relay_account WHERE account_id = ?",
      )
      .get(accountId) as
      | {
          auth_verifier_hash: Uint8Array;
          kdf_salt: Uint8Array;
          wrapped_master_key: Uint8Array;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      authVerifierHash: bytes(row.auth_verifier_hash),
      kdfSalt: bytes(row.kdf_salt),
      wrappedMasterKey: bytes(row.wrapped_master_key),
    };
  };

  const getAccountByUsername = (
    username: string,
  ): { accountId: string; kdfSalt: Uint8Array } | undefined => {
    const row = db
      .prepare(
        "SELECT account_id, kdf_salt FROM relay_account WHERE username = ?",
      )
      .get(username) as
      | { account_id: string; kdf_salt: Uint8Array }
      | undefined;
    if (row === undefined) return undefined;
    return { accountId: row.account_id, kdfSalt: bytes(row.kdf_salt) };
  };

  return {
    registerAccount(
      accountId,
      username,
      authVerifierHash,
      kdfSalt,
      wrappedMasterKey,
    ) {
      // Idempotent on the account id — re-registering the same device's account
      // keeps the first registration untouched.
      if (getAccount(accountId) !== undefined) return "exists";
      // A username is one account's forever; a different account claiming it is
      // a conflict, not an overwrite (the UNIQUE index is the backstop).
      if (getAccountByUsername(username) !== undefined) return "username-taken";

      db.prepare(
        `INSERT INTO relay_account
           (account_id, username, auth_verifier_hash, kdf_salt, wrapped_master_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        accountId,
        username,
        authVerifierHash as SQLInputValue,
        kdfSalt as SQLInputValue,
        wrappedMasterKey as SQLInputValue,
        Date.now(),
      );
      return "created";
    },

    getAccount,
    getAccountByUsername,

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
