/** The driver-contract suite: pins every {@link SqliteDriver} to identical
 *  observable behaviour (README, "The `SqliteDriver` port"). */
import type { SqliteDriver } from "../driver.js";

/** A factory yielding a fresh, isolated driver plus its teardown, per test. */
export type DriverFactory = () => {
  driver: SqliteDriver;
  cleanup: () => void | Promise<void>;
};

/** The slice of a test runner the suite drives; Vitest satisfies it, and a
 *  device runner supplies a shim. */
export interface TestApi {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>) => void;
  expect: (actual: unknown) => Matchers;
}

/** The matcher surface this suite actually uses. */
interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeInstanceOf(expected: unknown): void;
  rejects: { toThrow(expected?: unknown): Promise<void> };
}

/** Register the contract as a `describe` block against `makeDriver`, once per
 *  driver under test. */
export function runDriverContract(t: TestApi, makeDriver: DriverFactory): void {
  const { describe, it, expect } = t;

  // Run `body` against a fresh driver, guaranteeing teardown even on failure.
  const withDriver = async (
    body: (driver: SqliteDriver) => Promise<void>,
  ): Promise<void> => {
    const { driver, cleanup } = makeDriver();
    try {
      await body(driver);
    } finally {
      await cleanup();
    }
  };

  describe("SqliteDriver contract", () => {
    it("round-trips a row through run + get", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
        await driver.run("INSERT INTO t (id, name) VALUES (?, ?)", [1, "ada"]);

        const row = await driver.get<{ id: number; name: string }>(
          "SELECT id, name FROM t WHERE id = ?",
          [1],
        );
        expect(row).toEqual({ id: 1, name: "ada" });
      }));

    it("returns undefined (not null) from get on a miss", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const row = await driver.get("SELECT id FROM t WHERE id = ?", [999]);
        expect(row).toBeUndefined();
      }));

    it("returns every matching row from all, and [] when none match", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await driver.run("INSERT INTO t (id) VALUES (?)", [1]);
        await driver.run("INSERT INTO t (id) VALUES (?)", [2]);

        const rows = await driver.all<{ id: number }>("SELECT id FROM t");
        expect(rows.length).toBe(2);

        const empty = await driver.all("SELECT id FROM t WHERE id = ?", [999]);
        expect(empty).toEqual([]);
      }));

    it("honors ORDER BY in all()", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        for (const id of [3, 1, 2]) {
          await driver.run("INSERT INTO t (id) VALUES (?)", [id]);
        }

        const rows = await driver.all<{ id: number }>(
          "SELECT id FROM t ORDER BY id ASC",
        );
        expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
      }));

    it("binds positional params left-to-right", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (a TEXT, b TEXT, c TEXT)");
        await driver.run("INSERT INTO t (a, b, c) VALUES (?, ?, ?)", [
          "first",
          "second",
          "third",
        ]);

        const row = await driver.get<{ a: string; b: string; c: string }>(
          "SELECT a, b, c FROM t WHERE a = ? AND c = ?",
          ["first", "third"],
        );
        expect(row).toEqual({ a: "first", b: "second", c: "third" });
      }));

    it("round-trips a BLOB as bytes", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, blob BLOB)");
        const bytes = new Uint8Array([0, 1, 2, 250, 255]);
        await driver.run("INSERT INTO t (id, blob) VALUES (?, ?)", [1, bytes]);

        const row = await driver.get<{ blob: Uint8Array }>(
          "SELECT blob FROM t WHERE id = ?",
          [1],
        );
        // A Node Buffer (desktop) is a Uint8Array subclass, so this holds for
        // both backends; the bytes must match regardless of concrete class.
        expect(row?.blob).toBeInstanceOf(Uint8Array);
        expect(Array.from(row?.blob ?? [])).toEqual(Array.from(bytes));
      }));

    it("applies every statement in a multi-statement exec", () =>
      withDriver(async (driver) => {
        await driver.exec(
          "CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY);",
        );
        await driver.run("INSERT INTO a (id) VALUES (?)", [1]);
        await driver.run("INSERT INTO b (id) VALUES (?)", [2]);

        expect(await driver.get("SELECT id FROM a WHERE id = ?", [1])).toEqual({
          id: 1,
        });
        expect(await driver.get("SELECT id FROM b WHERE id = ?", [2])).toEqual({
          id: 2,
        });
      }));

    it("persists writes made inside a committed transaction", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        await driver.transaction(async () => {
          await driver.run("INSERT INTO t (id) VALUES (?)", [1]);
          await driver.run("INSERT INTO t (id) VALUES (?)", [2]);
        });

        const rows = await driver.all("SELECT id FROM t");
        expect(rows.length).toBe(2);
      }));

    it("rolls back all writes and rethrows when the transaction body throws", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        const boom = new Error("boom");

        await expect(
          driver.transaction(async () => {
            await driver.run("INSERT INTO t (id) VALUES (?)", [1]);
            throw boom;
          }),
        ).rejects.toThrow(boom);

        const rows = await driver.all("SELECT id FROM t");
        expect(rows).toEqual([]);
      }));

    it("returns the transaction body's resolved value", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

        const result = await driver.transaction(async () => {
          await driver.run("INSERT INTO t (id) VALUES (?)", [7]);
          return "ok" as const;
        });
        expect(result).toBe("ok");
      }));

    it("round-trips a SQL NULL as JS null", () =>
      withDriver(async (driver) => {
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
        await driver.run("INSERT INTO t (id, name) VALUES (?, ?)", [1, null]);

        const row = await driver.get<{ name: string | null }>(
          "SELECT name FROM t WHERE id = ?",
          [1],
        );
        expect(row?.name).toBeNull();
      }));

    it("closes the connection, and use after close rejects", () =>
      withDriver(async (driver) => {
        // `close()` is optional on the port; a driver that omits it opts out of
        // this case (both real drivers implement it, so it runs for them).
        if (!driver.close) return;
        await driver.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await driver.close();

        // Both engines throw on a closed handle; assert only that it rejects.
        await expect(driver.all("SELECT id FROM t")).rejects.toThrow();
      }));
  });
}
