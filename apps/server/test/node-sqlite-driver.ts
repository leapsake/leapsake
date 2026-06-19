import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { SqliteDriver } from "@leapsake/data";

/**
 * A {@link SqliteDriver} over `node:sqlite` for the integration tests — the same
 * binding the desktop main process supplies, so tests and prod never drift. (A
 * local copy of the helper `packages/data` uses; it is not part of the package's
 * public surface.)
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
