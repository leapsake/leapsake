// What proves two calls on one database file cannot overlap.
//
// The overlap is what frees a native handle under a running query — see the header of
// `with-database.ts` for the crashes that found it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const openDatabaseAsync = vi.fn();
vi.mock("expo-sqlite", () => ({ openDatabaseAsync }));

const { withDatabase } = await import("./with-database");

/** A handle that records the order of opens, closes and work against one name. */
function handle(log: string[], id: string) {
  return {
    closeAsync: vi.fn(async () => {
      log.push(`close ${id}`);
    }),
  };
}

beforeEach(() => {
  openDatabaseAsync.mockReset();
});

describe("withDatabase", () => {
  it("runs one caller at a time on the same file", async () => {
    const log: string[] = [];
    let opened = 0;
    openDatabaseAsync.mockImplementation(async (name: string) => {
      opened += 1;
      log.push(`open ${name}#${opened}`);
      return handle(log, `${name}#${opened}`);
    });

    const slow = withDatabase("doors.db", async () => {
      log.push("work a start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      log.push("work a end");
      return "a";
    });
    const quick = withDatabase("doors.db", async () => {
      log.push("work b");
      return "b";
    });

    await expect(Promise.all([slow, quick])).resolves.toEqual(["a", "b"]);
    expect(log).toEqual([
      "open doors.db#1",
      "work a start",
      "work a end",
      "close doors.db#1",
      "open doors.db#2",
      "work b",
      "close doors.db#2",
    ]);
  });

  it("does not make one file's callers wait for another's", async () => {
    const log: string[] = [];
    openDatabaseAsync.mockImplementation(async (name: string) => {
      log.push(`open ${name}`);
      return handle(log, name);
    });

    await Promise.all([
      withDatabase("doors.db", async () => {
        log.push("doors work");
      }),
      withDatabase("roster.db", async () => {
        log.push("roster work");
      }),
    ]);

    expect(log.filter((line) => line.startsWith("open"))).toHaveLength(2);
  });

  it("closes the handle, and keeps the queue moving, when work throws", async () => {
    const log: string[] = [];
    openDatabaseAsync.mockImplementation(async (name: string) =>
      handle(log, name),
    );

    await expect(
      withDatabase("doors.db", async () => {
        throw new Error("no such table");
      }),
    ).rejects.toThrow("no such table");
    expect(log).toEqual(["close doors.db"]);

    await expect(withDatabase("doors.db", async () => "after")).resolves.toBe(
      "after",
    );
  });
});
