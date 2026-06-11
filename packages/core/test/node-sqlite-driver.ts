import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDriver } from "@leapsake/core";

/**
 * A {@link SqliteDriver} backed by Node's built-in `node:sqlite`
 * (`DatabaseSync`), used for core's integration tests — the identical binding
 * the desktop main process supplies in production, so tests and prod never
 * drift.
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
