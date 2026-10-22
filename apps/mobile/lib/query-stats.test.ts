import { describe, expect, it } from "vitest";
import type { SqliteDriver } from "@leapsake/core";
import { type QuerySpan, createQueryStats, formatSpan } from "./query-stats";

function fakeDriver(): SqliteDriver {
  return {
    exec: async () => {},
    run: async () => {},
    all: async <T>() => [{ id: "george" }] as T[],
    get: async <T>() => ({ id: "mary" }) as T,
    transaction: (fn) => fn(),
  };
}

/** Resolves when `release` is called, to hold a span open. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

describe("createQueryStats", () => {
  it("reports every statement issued during a span, and the rows pass through", async () => {
    const spans: QuerySpan[] = [];
    const stats = createQueryStats(true, (s) => spans.push(s));
    const driver = stats.countStatements(fakeDriver());

    const rows = await stats.measure("load /", async () => {
      await driver.exec("BEGIN");
      await driver.run("UPDATE people SET last_name = ?", ["Bailey"]);
      await driver.get("SELECT 1");
      return driver.all<{ id: string }>("SELECT id FROM people");
    });

    expect(rows).toEqual([{ id: "george" }]);
    expect(spans).toEqual([
      expect.objectContaining({
        label: "load /",
        statements: 4,
        overlapping: [],
      }),
    ]);
  });

  it("counts statements inside a transaction", async () => {
    const spans: QuerySpan[] = [];
    const stats = createQueryStats(true, (s) => spans.push(s));
    const driver = stats.countStatements(fakeDriver());

    await stats.measure("write", () =>
      driver.transaction(async () => {
        await driver.run("INSERT INTO people (id) VALUES (?)", ["clarence"]);
        await driver.run("INSERT INTO people (id) VALUES (?)", ["violet"]);
      }),
    );

    expect(spans[0].statements).toBe(2);
  });

  it("names the spans that ran alongside each other, both ways", async () => {
    const spans: QuerySpan[] = [];
    const stats = createQueryStats(true, (s) => spans.push(s));
    const background = gate();

    const reconcile = stats.measure("reconcile notifications", () =>
      background.opened.then(() => undefined),
    );
    await stats.measure("load /", async () => {});
    background.release();
    await reconcile;
    await stats.measure("load /search", async () => {});

    expect(
      Object.fromEntries(spans.map((s) => [s.label, s.overlapping])),
    ).toEqual({
      "load /": ["reconcile notifications"],
      "reconcile notifications": ["load /"],
      "load /search": [],
    });
  });

  it("still reports a span whose work throws, and rethrows", async () => {
    const spans: QuerySpan[] = [];
    const stats = createQueryStats(true, (s) => spans.push(s));

    await expect(
      stats.measure("load /reminders/[id]", () =>
        Promise.reject(new Error("Potter")),
      ),
    ).rejects.toThrow("Potter");
    expect(spans.map((s) => s.label)).toEqual(["load /reminders/[id]"]);
  });

  it("when disabled, hands back the same driver and reports nothing", async () => {
    const spans: QuerySpan[] = [];
    const stats = createQueryStats(false, (s) => spans.push(s));
    const driver = fakeDriver();

    expect(stats.countStatements(driver)).toBe(driver);
    expect(await stats.measure("load /", async () => "Bedford Falls")).toBe(
      "Bedford Falls",
    );
    expect(spans).toEqual([]);
  });
});

describe("formatSpan", () => {
  it("is one greppable line, naming what overlapped", () => {
    expect(
      formatSpan({
        label: "load /",
        statements: 1840,
        ms: 6200,
        overlapping: ["reconcile notifications", "regenerate system reminders"],
      }),
    ).toBe(
      "[queries] load /: 1840 statements in 6200 ms (overlapping: reconcile notifications, regenerate system reminders)",
    );
  });
});
