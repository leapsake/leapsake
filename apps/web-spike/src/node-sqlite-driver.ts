import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { SqliteDriver } from "@leapsake/data";

/**
 * A {@link SqliteDriver} over `node:sqlite`, for the spike's server-side store.
 *
 * A **verbatim copy** of `apps/server/test/node-sqlite-driver.ts`, on purpose:
 * `packages/data` ships zero drivers by design and every app owns its own, so
 * copying 37 lines is the house pattern rather than a shortcut (spike doc →
 * *Decisions already made*). The browser driver in Increment 5 is the same seam
 * over `@sqlite.org/sqlite-wasm`.
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
