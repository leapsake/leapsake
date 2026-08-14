import type { BindingSpec, Database } from "@sqlite.org/sqlite-wasm";
import type { SqliteDriver } from "@leapsake/data";

/**
 * A {@link SqliteDriver} over `@sqlite.org/sqlite-wasm`'s `oo1` API — **the
 * browser's half of the port, and the thing Increment 5a exists to test.**
 *
 * Same seam as `node-sqlite-driver.ts` next door, for the same reason:
 * `packages/data` ships zero drivers by design, so every app owns one (spike doc
 * → *Decisions that still bind*). What that decision costs a web client is this
 * file, and the answer to "is the browser data layer possible?" is whether the
 * shared `runDriverContract` passes against it unchanged.
 *
 * The two engines are close enough that this is a near-transcription of the
 * `node:sqlite` driver. Three places where oo1 is *not* `node:sqlite` — read out
 * of oo1's own source before the first run, so the contract never saw them fail:
 *
 * 1. **An empty `bind` throws.** `db.exec({ sql, bind: [] })` on a statement with
 *    no parameters raises "This statement has no bindable parameters" — oo1
 *    distinguishes *absent* bindings from *empty* ones, where
 *    `db.prepare(sql).run(...[])` does not. Hence the `params.length === 0`
 *    branches: the driver's port says `params?: unknown[]`, and callers pass `[]`
 *    freely. `runMigrations`'s own first statement (`PRAGMA user_version`) is one,
 *    so without this branch the schema would fail on line one.
 * 2. **`selectObject` already returns `undefined` on a miss**, which is the
 *    contract's "undefined, not null" case satisfied by the engine rather than by
 *    a wrapper.
 * 3. **`close()` is idempotent** (a documented no-op once closed), so unlike the
 *    desktop and mobile factories this one needs no already-closed guard in its
 *    teardown.
 *
 * Everything else — positional binds left to right, `Uint8Array` in and out of a
 * BLOB, SQL `NULL` as JS `null`, multi-statement `exec`, `BEGIN`/`COMMIT`/
 * `ROLLBACK` — is the same code as the Node driver's, and `oo1` behaves the same.
 */
export function wasmSqliteDriver(db: Database): SqliteDriver {
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params = []) {
      if (params.length === 0) db.exec(sql);
      else db.exec({ sql, bind: params as BindingSpec });
    },
    async all<T>(sql: string, params: unknown[] = []) {
      return (
        params.length === 0
          ? db.selectObjects(sql)
          : db.selectObjects(sql, params as BindingSpec)
      ) as T[];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      return (
        params.length === 0
          ? db.selectObject(sql)
          : db.selectObject(sql, params as BindingSpec)
      ) as T | undefined;
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
