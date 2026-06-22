import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";

/**
 * The production at-rest {@link SqliteDriver} (encryption Stage 2, `model.md` §8):
 * the on-disk database file is **ciphertext**, decrypted into memory page-by-page
 * only while this process holds the whole-DB key. It replaces the plaintext
 * `node:sqlite` driver for the real app DB — `node:sqlite` has no encryption, so
 * at-rest is the one place its native-module-free win yields (status.md).
 *
 * Backend: `better-sqlite3-multiple-ciphers` (SQLite3-Multiple-Ciphers), chosen by
 * the Stage-2 spike over a WASM build because it is the only maintained,
 * batteries-included encrypted SQLite for Node/Electron, ships prebuilt binaries
 * for both Node (tests) and Electron (the app) — no node-gyp compile — and is
 * **synchronous**, so this stays a near drop-in for `nodeSqliteDriver` (the manual
 * BEGIN/COMMIT/ROLLBACK is safe for the same reason: inner calls resolve
 * synchronously, and nothing in the codebase nests transactions).
 *
 * The whole-DB key is supplied by the device enclave at open time
 * (see `database-key.ts`), entirely orthogonal to the in-DB master-key hierarchy:
 * at-rest protects the *file*; per-item content keys (wrapped under MK) live
 * *inside* the decrypted DB and are the sync/sharing envelope. They compose and do
 * not interact.
 */

/** The opened, keyed handle — shared with the one-time plaintext→encrypted migration. */
export type EncryptedDatabase = Database.Database;

/** Apply the cipher + raw key to a freshly opened handle, before any other
 *  statement. Pinned to `sqlcipher` so reopening always uses the same scheme. */
export function applyDatabaseKey(db: EncryptedDatabase, key: Uint8Array): void {
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key="${rawKeyLiteral(key)}"`);
}

/**
 * Open `path` as an encrypted database under `key`. Applies the key, then forces a
 * read of page 1 (`PRAGMA user_version`) so a wrong/absent key fails **here** with
 * a clear error rather than later mid-query — an encrypted file under the wrong key
 * reads as "file is not a database".
 */
export function openEncryptedDatabase(
  path: string,
  key: Uint8Array,
): EncryptedDatabase {
  const db = new Database(path);
  applyDatabaseKey(db, key);
  try {
    db.pragma("user_version");
  } catch (error) {
    db.close();
    throw new Error(
      "Failed to open the encrypted database — wrong or missing key.",
      { cause: error },
    );
  }
  return db;
}

/**
 * Wrap an opened, keyed {@link EncryptedDatabase} as a {@link SqliteDriver}. The
 * body mirrors `nodeSqliteDriver`: `better-sqlite3` binds the same value shapes
 * (numbers, strings, `Uint8Array` → BLOB, `null`) and returns BLOBs as `Buffer`
 * (a `Uint8Array` subclass), so the repos above the port are unaffected.
 */
export function encryptedSqliteDriver(db: EncryptedDatabase): SqliteDriver {
  return {
    async exec(sql) {
      db.exec(sql);
    },

    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },

    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },

    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...params) as T | undefined;
    },

    async transaction<T>(fn: () => Promise<T>) {
      db.exec("BEGIN");
      try {
        const result = await fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
