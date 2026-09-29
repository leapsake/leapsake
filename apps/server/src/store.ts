import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { EncryptedRecord } from "@leapsake/sync";

// The relay's own store: accounts (a verifier hash, salt, username and
// ciphertext) and an append log whose `seq` is the delivery cursor.

export interface RelayAccount {
  authVerifierHash: Uint8Array;
  kdfSalt: Uint8Array;
  /** Ciphertext `wrap(MK, KEK)`, opaque to the relay. */
  wrappedMasterKey: Uint8Array;
  /** Ciphertext `wrap(recoveryKey, MK)`, so a joining device reveals the
   *  account's phrase; absent on older accounts. */
  wrappedRecoveryKey?: Uint8Array;
  /** Ciphertext `wrap(MK, recoveryKey)`: the recovery escrow. */
  wrappedMasterKeyRecovery?: Uint8Array;
  /** `sha256(recoveryVerifier)`, authenticating a recovery without the key. */
  recoveryVerifierHash?: Uint8Array;
}

/** Outcome of {@link RelayStore.registerAccount}, mapped to an HTTP status. */
export type RegisterResult = "created" | "exists" | "username-taken";

export interface RelayStore {
  /** Registers an account; the same id again is `"exists"`, another account's
   *  username `"username-taken"`. */
  registerAccount(
    accountId: string,
    username: string,
    authVerifierHash: Uint8Array,
    kdfSalt: Uint8Array,
    wrappedMasterKey: Uint8Array,
    wrappedRecoveryKey: Uint8Array | undefined,
    wrappedMasterKeyRecovery: Uint8Array | undefined,
    recoveryVerifierHash: Uint8Array | undefined,
  ): RegisterResult;
  getAccount(accountId: string): RelayAccount | undefined;
  /** Replaces the password door, as the recovery-authenticated reset does. */
  setCredentials(
    accountId: string,
    authVerifierHash: Uint8Array,
    kdfSalt: Uint8Array,
    wrappedMasterKey: Uint8Array,
  ): void;
  /** Replaces all three recovery fields at once; neither door can be replaced
   *  with the credential it replaces. */
  setRecovery(
    accountId: string,
    wrappedRecoveryKey: Uint8Array,
    wrappedMasterKeyRecovery: Uint8Array,
    recoveryVerifierHash: Uint8Array,
  ): void;
  /** Prelogin: a username's account id and public salt, or undefined. */
  getAccountByUsername(
    username: string,
  ): { accountId: string; kdfSalt: Uint8Array } | undefined;
  /** Append records to one account's blind log, each taking the next `seq`. */
  append(accountId: string, records: EncryptedRecord[]): void;
  /** This account's records after `since`, and the advanced cursor. */
  pull(
    accountId: string,
    since: number,
  ): { records: EncryptedRecord[]; cursor: number };
}

/** A `node:sqlite` BLOB, a Buffer, as a plain Uint8Array. */
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

  // Added in place, as `IF NOT EXISTS` never alters a table; a duplicate
  // column is the expected steady state.
  for (const column of [
    "wrapped_recovery_key BLOB",
    "wrapped_master_key_recovery BLOB",
    "recovery_verifier_hash BLOB",
  ]) {
    try {
      db.exec(`ALTER TABLE relay_account ADD COLUMN ${column}`);
    } catch {
      // Column already exists — the steady state after the first run.
    }
  }

  const getAccount = (accountId: string): RelayAccount | undefined => {
    const row = db
      .prepare(
        `SELECT auth_verifier_hash, kdf_salt, wrapped_master_key,
                wrapped_recovery_key, wrapped_master_key_recovery,
                recovery_verifier_hash
           FROM relay_account WHERE account_id = ?`,
      )
      .get(accountId) as
      | {
          auth_verifier_hash: Uint8Array;
          kdf_salt: Uint8Array;
          wrapped_master_key: Uint8Array;
          wrapped_recovery_key: Uint8Array | null;
          wrapped_master_key_recovery: Uint8Array | null;
          recovery_verifier_hash: Uint8Array | null;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      authVerifierHash: bytes(row.auth_verifier_hash),
      kdfSalt: bytes(row.kdf_salt),
      wrappedMasterKey: bytes(row.wrapped_master_key),
      wrappedRecoveryKey:
        row.wrapped_recovery_key === null
          ? undefined
          : bytes(row.wrapped_recovery_key),
      wrappedMasterKeyRecovery:
        row.wrapped_master_key_recovery === null
          ? undefined
          : bytes(row.wrapped_master_key_recovery),
      recoveryVerifierHash:
        row.recovery_verifier_hash === null
          ? undefined
          : bytes(row.recovery_verifier_hash),
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
      wrappedRecoveryKey,
      wrappedMasterKeyRecovery,
      recoveryVerifierHash,
    ) {
      // Idempotent: the first registration of an id stands.
      if (getAccount(accountId) !== undefined) return "exists";
      // A username is one account's forever; the UNIQUE index backs this up.
      if (getAccountByUsername(username) !== undefined) return "username-taken";

      db.prepare(
        `INSERT INTO relay_account
           (account_id, username, auth_verifier_hash, kdf_salt, wrapped_master_key,
            wrapped_recovery_key, wrapped_master_key_recovery, recovery_verifier_hash,
            created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        accountId,
        username,
        authVerifierHash as SQLInputValue,
        kdfSalt as SQLInputValue,
        wrappedMasterKey as SQLInputValue,
        (wrappedRecoveryKey ?? null) as SQLInputValue,
        (wrappedMasterKeyRecovery ?? null) as SQLInputValue,
        (recoveryVerifierHash ?? null) as SQLInputValue,
        Date.now(),
      );
      return "created";
    },

    setCredentials(accountId, authVerifierHash, kdfSalt, wrappedMasterKey) {
      db.prepare(
        `UPDATE relay_account
            SET auth_verifier_hash = ?, kdf_salt = ?, wrapped_master_key = ?
          WHERE account_id = ?`,
      ).run(
        authVerifierHash as SQLInputValue,
        kdfSalt as SQLInputValue,
        wrappedMasterKey as SQLInputValue,
        accountId,
      );
    },

    setRecovery(
      accountId,
      wrappedRecoveryKey,
      wrappedMasterKeyRecovery,
      recoveryVerifierHash,
    ) {
      db.prepare(
        `UPDATE relay_account
            SET wrapped_recovery_key = ?, wrapped_master_key_recovery = ?,
                recovery_verifier_hash = ?
          WHERE account_id = ?`,
      ).run(
        wrappedRecoveryKey as SQLInputValue,
        wrappedMasterKeyRecovery as SQLInputValue,
        recoveryVerifierHash as SQLInputValue,
        accountId,
      );
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
