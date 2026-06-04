import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDriver } from "@leapsake/data";

/**
 * The production {@link SqliteDriver}, backed by Node's built-in `node:sqlite`
 * (`DatabaseSync`) in the Electron main process. Mirrors the integration-test
 * adapter in `packages/data/test`; `packages/data` itself stays driver-free so
 * it can be reused on mobile with an expo-sqlite adapter.
 *
 * `DatabaseSync` is fully synchronous, so each method wraps a sync call in a
 * resolved promise. `transaction` is implemented manually with
 * BEGIN/COMMIT/ROLLBACK — safe here because the inner driver calls resolve
 * synchronously.
 */
export function nodeSqliteDriver(db: DatabaseSync): SqliteDriver {
  return {
    async exec(sql) {
      db.exec(sql);
    },

    async run(sql, params = []) {
      db.prepare(sql).run(...(params as SQLInputValue[]));
    },

    async all<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as SQLInputValue[])) as T[];
    },

    async get<T>(sql: string, params: unknown[] = []) {
      return db.prepare(sql).get(...(params as SQLInputValue[])) as
        | T
        | undefined;
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
