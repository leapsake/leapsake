import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";

/** An opened handle from this engine, keyed or not. */
export type EncryptedDatabase = Database.Database;

/** Before any other statement; pinned so every reopen uses the same cipher. */
export function applyDatabaseKey(db: EncryptedDatabase, key: Uint8Array): void {
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key="${rawKeyLiteral(key)}"`);
}

/**
 * Reads page 1 straight away, so a wrong key fails here with a clear error
 * rather than mid-query as "file is not a database".
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
 * Wraps any handle from this engine, keyed or not: encryption is decided by
 * which opener ran. Manual BEGIN/COMMIT is safe because every call is sync.
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

    async close() {
      db.close();
    },
  };
}
