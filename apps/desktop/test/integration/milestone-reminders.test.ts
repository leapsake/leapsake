import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { createReminderRulesRepo } from "@leapsake/data";
import type { ReminderRuleInput } from "@leapsake/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let core: CoreApi;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  core = createCore(driver);
});

afterEach(() => {
  cleanup();
});

/** A recurring birthday for a fresh person; returns the milestone. */
async function birthdayFor(schedule?: ReminderRuleInput[]) {
  const person = await core.people.create(
    { firstName: "Ada", middleName: null, lastName: "Lovelace", gender: null },
    [],
  );
  const milestone = await core.milestones.create({
    kind: "birthday",
    bearerType: "person",
    bearerId: person.id,
    year: null,
    month: 3,
    day: 9,
    ...(schedule ? { reminderSchedule: schedule } : {}),
  });
  return milestone;
}

describe("core.milestones — reminder schedule", () => {
  it("resolves to the kind defaults when the milestone was never customised", async () => {
    const milestone = await birthdayFor();
    const resolved = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    expect(resolved.map((r) => r.action)).toEqual([
      "get:gift",
      "get:card",
      "send:card",
      "wish",
      "call",
      "message:sms",
    ]);
    // Only the birthday wish is on by default.
    expect(resolved.filter((r) => r.enabled).map((r) => r.action)).toEqual([
      "wish",
    ]);

    // No rule rows were written for the untouched milestone.
    const rows = await createReminderRulesRepo(driver).listForBearer(
      "milestone",
      milestone.id,
    );
    expect(rows).toHaveLength(0);
  });

  it("persists a submitted schedule atomically with the milestone", async () => {
    const milestone = await birthdayFor([
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
      { action: "call", label: null, offsetDays: 0, enabled: false },
    ]);

    const resolved = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    expect(resolved.map((r) => r.action)).toEqual(["get:gift", "call"]);
    expect(resolved[0]).toMatchObject({ offsetDays: 21, enabled: true });
    expect(resolved[1]).toMatchObject({ offsetDays: 0, enabled: false });
  });

  it("replaces the schedule on update", async () => {
    const milestone = await birthdayFor([
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
    ]);
    await core.milestones.update(milestone.id, {
      reminderSchedule: [
        {
          action: "other",
          label: "Send flowers",
          offsetDays: 2,
          enabled: true,
        },
      ],
    });

    const resolved = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({
      action: "other",
      label: "Send flowers",
      offsetDays: 2,
    });
  });

  it("leaves the stored rules untouched when update omits a schedule", async () => {
    const milestone = await birthdayFor([
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
    ]);
    await core.milestones.update(milestone.id, { note: "First one" });

    const resolved = await core.milestones.reminderSchedule(
      milestone.id,
      "birthday",
    );
    expect(resolved.map((r) => r.action)).toEqual(["get:gift"]);
  });

  it("drops the reminder rules when the milestone is deleted", async () => {
    const milestone = await birthdayFor([
      { action: "get:gift", label: null, offsetDays: 21, enabled: true },
    ]);
    await core.milestones.softDelete(milestone.id);

    const rows = await createReminderRulesRepo(driver).listForBearer(
      "milestone",
      milestone.id,
    );
    expect(rows).toHaveLength(0);
  });
});
