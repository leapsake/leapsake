import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { type SqliteDriver, serialTransaction } from "../driver.js";

/** A {@link SqliteDriver} over Node's built-in `node:sqlite`, for tests that
 *  need real SQLite without a native module. */
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
    transaction: serialTransaction((sql) => db.exec(sql)),
    close: async () => db.close(),
  };
}
