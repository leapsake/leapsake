import type { ReminderRuleInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ReminderRulesRepo,
  type SqliteDriver,
  createReminderRulesRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let reopen: () => SqliteDriver;
let repo: ReminderRulesRepo;

const MILESTONE = crypto.randomUUID();

/** The birthday-style default set, furthest-out first. */
const schedule: ReminderRuleInput[] = [
  { action: "get:gift", label: null, offsetDays: 30, enabled: true },
  { action: "send:card", label: null, offsetDays: 7, enabled: true },
  { action: "call", label: null, offsetDays: 0, enabled: false },
  { action: "other", label: "Bake a cake", offsetDays: 0, enabled: true },
];

beforeEach(async () => {
  ({ driver, cleanup, reopen } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createReminderRulesRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("reminderRulesRepo", () => {
  it("round-trips a bearer's schedule, furthest lead first", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    const rows = await repo.listForBearer("milestone", MILESTONE);

    expect(rows.map((r) => r.action)).toEqual([
      "get:gift",
      "send:card",
      "call",
      "other",
    ]);
    expect(rows.map((r) => r.offsetDays)).toEqual([30, 7, 0, 0]);
    // The 0/1 SQLite column decodes back to a real boolean.
    expect(rows.find((r) => r.action === "call")?.enabled).toBe(false);
    expect(rows.find((r) => r.action === "other")?.label).toBe("Bake a cake");
    for (const row of rows) {
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row.bearerType).toBe("milestone");
      expect(row.bearerId).toBe(MILESTONE);
      expect(row.deletedAt).toBeNull();
    }
  });

  // The set-level guard, on the write path every editor and the prompt's answer
  // go through. A duplicate identity is invisible to a per-row schema and there
  // is no unique constraint on the table, so if it were not caught here it would
  // reach the engine — which keys its desired set by derived id and would
  // quietly keep one of the two.
  it("rejects a duplicate action, writing nothing", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    await expect(
      repo.replaceForBearer("milestone", MILESTONE, [
        { action: "get:gift", label: null, offsetDays: 30, enabled: true },
        { action: "get:gift", label: null, offsetDays: 5, enabled: true },
      ]),
    ).rejects.toThrow();
    // Validated up front, so the existing schedule is untouched.
    const rows = await repo.listForBearer("milestone", MILESTONE);
    expect(rows).toHaveLength(4);
  });

  it("accepts two qualifiers of one verb, and two labelled `other`s", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, [
      { action: "get:gift", label: null, offsetDays: 12, enabled: true },
      { action: "get:card", label: null, offsetDays: 5, enabled: true },
      { action: "other", label: "Send flowers", offsetDays: 0, enabled: true },
      { action: "other", label: "Book a table", offsetDays: 0, enabled: true },
    ]);
    const rows = await repo.listForBearer("milestone", MILESTONE);
    expect(rows.map((r) => r.action)).toEqual([
      "get:gift",
      "get:card",
      "other",
      "other",
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      null,
      null,
      "Send flowers",
      "Book a table",
    ]);
  });

  it("replaces the whole set — the prior rules are soft-deleted", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    await repo.replaceForBearer("milestone", MILESTONE, [
      { action: "call", label: null, offsetDays: 3, enabled: true },
    ]);

    const rows = await repo.listForBearer("milestone", MILESTONE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "call", offsetDays: 3 });
  });

  it("clears the schedule when replaced with an empty set", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    await repo.replaceForBearer("milestone", MILESTONE, []);
    expect(await repo.listForBearer("milestone", MILESTONE)).toHaveLength(0);
  });

  it("removeAllForBearer soft-deletes the bearer's rules", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    await repo.removeAllForBearer("milestone", MILESTONE);
    expect(await repo.listForBearer("milestone", MILESTONE)).toHaveLength(0);
  });

  it("survives a cold reopen (whole-DB at rest)", async () => {
    await repo.replaceForBearer("milestone", MILESTONE, schedule);
    const reopened = createReminderRulesRepo(reopen());
    const rows = await reopened.listForBearer("milestone", MILESTONE);
    expect(rows.map((r) => r.action)).toEqual([
      "get:gift",
      "send:card",
      "call",
      "other",
    ]);
  });
});
