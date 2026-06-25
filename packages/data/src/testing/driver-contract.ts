/**
 * The driver-contract conformance suite: one reusable spec that pins any
 * {@link SqliteDriver} implementation to identical *observable* behavior.
 *
 * Leapsake ships two real drivers built on unrelated native libraries —
 * `encryptedSqliteDriver` (desktop, `better-sqlite3-multiple-ciphers`) and
 * `expoSqliteDriver` (mobile, `expo-sqlite`) — behind this one port. Everything
 * above the port is written once and assumed to behave the same on either backend;
 * this suite is what *enforces* that, guarding the seam directly under at-rest
 * encryption. See `plans/testing/` for the strategy (this is the keystone).
 *
 * The suite is framework-agnostic by design: it imports nothing from a test runner
 * and instead receives the test primitives ({@link TestApi}) and a driver
 * {@link DriverFactory} as parameters. Desktop supplies Vitest's
 * `describe`/`it`/`expect`; the future mobile native tier will supply its own
 * runner's equivalents and run this *exact* spec unchanged.
 *
 * It is also schema-independent: each case creates its own throwaway table via
 * `exec`, so it tests the driver, not the app schema or migrations. Each case
 * provisions and tears down its own driver (`try`/`finally`), so the {@link TestApi}
 * needs no `beforeEach`/`afterEach` hooks — keeping it portable to a bare runner.
 */
import type { SqliteDriver } from "../driver.js";

/** A factory yielding a fresh, isolated driver plus its teardown, per test. */
export type DriverFactory = () => {
  driver: SqliteDriver;
  cleanup: () => void | Promise<void>;
};

/**
 * The minimal slice of a test runner the suite drives. Vitest's
 * `{ describe, it, expect }` satisfy this structurally; a mobile runner can supply
 * a small shim. `expect` is typed loosely on purpose so the suite stays decoupled
 * from any one runner's matcher types.
 */
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

/**
 * Register the contract as a `describe` block of `it` cases against `makeDriver`.
 * Call once per driver under test, e.g.
 * `runDriverContract({ describe, it, expect }, makeEncryptedTestDriver)`.
 */
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
  });
}
