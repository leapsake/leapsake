import type Database from "better-sqlite3";
import type { SqliteDriver } from "@leapsake/data";

/**
 * The production {@link SqliteDriver}, backed by better-sqlite3 in the Electron
 * main process. Mirrors the integration-test adapter in `packages/data/test`;
 * `packages/data` itself stays driver-free so it can be reused on mobile with an
 * expo-sqlite adapter.
 *
 * better-sqlite3 is fully synchronous, so each method wraps a sync call in a
 * resolved promise. Its native `db.transaction()` forbids async callbacks, so
 * `transaction` is implemented manually with BEGIN/COMMIT/ROLLBACK — safe here
 * because the inner driver calls resolve synchronously.
 */
export function betterSqlite3Driver(db: Database.Database): SqliteDriver {
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
