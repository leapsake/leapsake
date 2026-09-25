import type Database from "better-sqlite3-multiple-ciphers";
import type { SqliteDriver } from "@leapsake/core";

/** A driver over the engine desktop ships, for Vitest tiers that need real SQLite. */
export function sqliteDriver(db: Database.Database): SqliteDriver {
  return {
    exec: async (sql) => void db.exec(sql),
    run: async (sql, params = []) => void db.prepare(sql).run(...params),
    all: async <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: async <T>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
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
    close: async () => void db.close(),
  };
}
