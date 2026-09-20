// What proves `close()` cannot pull the store out from under a query in flight.
//
// The bug this pins was found on hosted runners (2026-09-20): the reminders reconciler fires
// and forgets, a reset closes the driver mid-await, and the native statement is freed beneath
// the call — Android rejected the next `NativeStatement` call, iOS died with SIGSEGV on the
// freed pointer. Checking liveness at the call site cannot fix it; the close can always land
// one instruction later, so the driver has to hold it.
import type { SQLiteDatabase } from "expo-sqlite";
import { describe, expect, it, vi } from "vitest";

import { STORE_CLOSED, expoSqliteDriver } from "./expo-sqlite-driver";

/** A database whose reads hang until the test releases them. */
function pausableDb() {
  let release!: (rows: unknown[]) => void;
  const pending = new Promise<unknown[]>((resolve) => {
    release = resolve;
  });
  const db = {
    execAsync: vi.fn(async () => {}),
    runAsync: vi.fn(async () => ({}) as never),
    getAllAsync: vi.fn(() => pending),
    getFirstAsync: vi.fn(async () => null),
    closeAsync: vi.fn(async () => {}),
  };
  return { db: db as unknown as SQLiteDatabase, calls: db, release };
}

describe("expoSqliteDriver", () => {
  it("does not close while a query is in flight", async () => {
    const { db, calls, release } = pausableDb();
    const driver = expoSqliteDriver(db);

    const reading = driver.all("select 1");
    const closing = driver.close?.();
    await Promise.resolve();

    expect(calls.closeAsync).not.toHaveBeenCalled();

    release([{ one: 1 }]);
    await expect(reading).resolves.toEqual([{ one: 1 }]);
    await closing;
    expect(calls.closeAsync).toHaveBeenCalledOnce();
  });

  it("refuses work started after close, without touching the database", async () => {
    const { db, calls } = pausableDb();
    const driver = expoSqliteDriver(db);

    await driver.close?.();

    await expect(driver.all("select 1")).rejects.toThrow(STORE_CLOSED);
    await expect(driver.run("insert into t values (1)")).rejects.toThrow(
      STORE_CLOSED,
    );
    expect(calls.getAllAsync).not.toHaveBeenCalled();
    expect(calls.runAsync).not.toHaveBeenCalled();
  });

  it("closes once, however many callers ask", async () => {
    const { db, calls } = pausableDb();
    const driver = expoSqliteDriver(db);

    await Promise.all([driver.close?.(), driver.close?.(), driver.close?.()]);

    expect(calls.closeAsync).toHaveBeenCalledOnce();
  });

  it("is not wedged by a query that threw", async () => {
    const { db, calls } = pausableDb();
    (calls.getAllAsync as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("no such table"),
    );
    const driver = expoSqliteDriver(db);

    await expect(driver.all("select 1")).rejects.toThrow("no such table");
    await driver.close?.();

    expect(calls.closeAsync).toHaveBeenCalledOnce();
  });

  it("holds the close until a transaction finishes, then rolls nothing back", async () => {
    const { db, calls, release } = pausableDb();
    const driver = expoSqliteDriver(db);

    const work = driver.transaction(async () => driver.all("select 1"));
    const closing = driver.close?.();
    await Promise.resolve();
    expect(calls.closeAsync).not.toHaveBeenCalled();

    release([]);
    await work;
    await closing;
    expect(calls.execAsync).toHaveBeenCalledWith("COMMIT");
    expect(calls.execAsync).not.toHaveBeenCalledWith("ROLLBACK");
  });
});
