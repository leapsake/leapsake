import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { createMilestonesRepo } from "@leapsake/data";
import {
  type CivilDate,
  type Milestone,
  civilFromDueMs,
  daysUntil,
  mentionToken,
  reminderLabel,
  todayCivil,
} from "@leapsake/schema";
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

/** The civil date `days` after today, normalised across month/year boundaries. */
function civilDaysFromToday(days: number): CivilDate {
  const t = todayCivil();
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/** The `system` reminders currently live, via the normal core read. */
async function systemReminders() {
  return (await core.reminders.list()).filter((r) => r.source === "system");
}

describe("core.reminders.regenerateSystem (birthday engine)", () => {
  it("generates a dated birthday reminder for a person ~10 days out", async () => {
    const alice = await core.people.create(
      { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const soon = civilDaysFromToday(10);
    // A recurring birthday (month+day, no birth year).
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice.id,
      month: soon.month,
      day: soon.day,
    });

    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 1, removed: 0 });

    const [reminder] = await systemReminders();
    // The subject is wrapped in an inline mention token carrying the person id, so
    // the name links to her page; the plain-text label strips back to her name.
    expect(reminder.title).toBe(
      `🎂 ${mentionToken("Alice Ng", "person", alice.id)}'s birthday`,
    );
    expect(reminderLabel(reminder)).toBe("🎂 Alice Ng's birthday");
    // Core resolves the mention to the person's current label for the renderer.
    expect(reminder.mentions).toEqual([
      { targetType: "person", targetId: alice.id, label: "Alice Ng" },
    ]);
    expect(reminder.dueDate).not.toBeNull();
    // Dated exactly 10 civil days out, so the client shows "in 10 days".
    expect(daysUntil(todayCivil(), civilFromDueMs(reminder.dueDate!))).toBe(10);
  });

  it("relabels the birthday mention live when the person is renamed", async () => {
    const alice = await core.people.create(
      { firstName: "Alice", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const soon = civilDaysFromToday(6);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: alice.id,
      month: soon.month,
      day: soon.day,
    });
    await core.reminders.regenerateSystem();

    await core.people.update(
      alice.id,
      { firstName: "Alicia", middleName: null, lastName: "Ng", gender: null },
      [],
    );

    // The stored title is frozen (the engine never rewrites it), but the resolved
    // mention re-reads the current label, so the link renders "Alicia Ng".
    const [reminder] = await systemReminders();
    expect(reminder.mentions[0].label).toBe("Alicia Ng");
  });

  it("is idempotent across runs (no duplicates, stable id)", async () => {
    const p = await core.people.create(
      { firstName: "Bob", middleName: null, lastName: "Lee", gender: null },
      [],
    );
    const soon = civilDaysFromToday(5);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });

    await core.reminders.regenerateSystem();
    const firstId = (await systemReminders())[0].id;

    const second = await core.reminders.regenerateSystem();
    expect(second).toEqual({ created: 0, removed: 0 });
    const rows = await systemReminders();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(firstId);
  });

  it("removes the reminder when its milestone is deleted", async () => {
    const p = await core.people.create(
      { firstName: "Cara", middleName: null, lastName: "Ito", gender: null },
      [],
    );
    const soon = civilDaysFromToday(7);
    const milestone = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });
    await core.reminders.regenerateSystem();
    expect(await systemReminders()).toHaveLength(1);

    await core.milestones.softDelete(milestone.id);
    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 0, removed: 1 });
    expect(await systemReminders()).toHaveLength(0);
  });

  it("never resurrects a dismissed birthday reminder", async () => {
    const p = await core.people.create(
      { firstName: "Dev", middleName: null, lastName: "Roy", gender: null },
      [],
    );
    const soon = civilDaysFromToday(8);
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: p.id,
      month: soon.month,
      day: soon.day,
    });
    await core.reminders.regenerateSystem();
    const id = (await systemReminders())[0].id;

    await core.reminders.softDelete(id); // user dismisses it

    const result = await core.reminders.regenerateSystem();
    expect(result).toEqual({ created: 0, removed: 0 });
    expect(await systemReminders()).toHaveLength(0);
    expect(await core.reminders.get(id)).toBeUndefined(); // still tombstoned
  });

  it("mints the SAME reminder id on two independent devices (cross-device dedup)", async () => {
    // The dedup proof: two cores over separate drivers, each holding the *same*
    // milestone id (as it would be after sync), derive an identical reminder id —
    // so the existing whole-row merge collapses them instead of duplicating.
    const soon = civilDaysFromToday(9);
    const milestoneId = crypto.randomUUID();

    const idOnDevice = async (): Promise<string> => {
      const d = makeEncryptedTestDriver();
      try {
        await runMigrations(d.driver);
        const deviceCore = createCore(d.driver);
        const person = await deviceCore.people.create(
          { firstName: "Eve", middleName: null, lastName: "Sun", gender: null },
          [],
        );
        // Insert the milestone under a fixed, shared id (bypassing create's random
        // id) so both devices scan the same trigger identity.
        const milestone: Milestone = {
          id: milestoneId,
          kind: "birthday",
          bearerType: "person",
          bearerId: person.id,
          year: null,
          month: soon.month,
          day: soon.day,
          note: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          deletedAt: null,
        };
        await createMilestonesRepo(d.driver).insert(milestone);
        await deviceCore.reminders.regenerateSystem();
        const rows = (await deviceCore.reminders.list()).filter(
          (r) => r.source === "system",
        );
        expect(rows).toHaveLength(1);
        return rows[0].id;
      } finally {
        d.cleanup();
      }
    };

    const [idA, idB] = [await idOnDevice(), await idOnDevice()];
    expect(idA).toBe(idB);
  });
});
