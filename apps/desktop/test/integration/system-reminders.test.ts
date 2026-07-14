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

    // core.milestones.create reconciles the birthday reminders in the same call,
    // so the reminder is live immediately — no explicit regenerateSystem needed.
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
    expect(second).toEqual({ created: 0, updated: 0, removed: 0 });
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
    expect(await systemReminders()).toHaveLength(1);

    // Deleting the milestone prunes its reminder in the same call — no relaunch.
    await core.milestones.softDelete(milestone.id);
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
    expect(result).toEqual({ created: 0, updated: 0, removed: 0 });
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

// The reported bugs: birthday reminders only reconciled at boot/focus, so adding,
// re-dating, or deleting a birthday didn't reflect until a relaunch. Folding the
// reconcile into the milestone write fixes all three; these drive the write and
// assert the reminder state without any explicit regenerateSystem().
describe("milestone writes reconcile birthday reminders at once", () => {
  /** Create a person with a birthday `days` out; return the person + milestone. */
  async function personWithBirthday(days: number) {
    const person = await core.people.create(
      { firstName: "Faye", middleName: null, lastName: "Ng", gender: null },
      [],
    );
    const occ = civilDaysFromToday(days);
    const milestone = await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: person.id,
      month: occ.month,
      day: occ.day,
    });
    return { person, milestone };
  }

  it("shows a new birthday on the Home list (and the person's backlink) at once", async () => {
    const { person } = await personWithBirthday(5);

    // No explicit regenerateSystem: creating the birthday already reconciled it.
    const [reminder] = await systemReminders();
    expect(reminder).toBeDefined();
    expect(daysUntil(todayCivil(), civilFromDueMs(reminder.dueDate!))).toBe(5);

    // And it backlinks onto the person's "Mentioned in" section.
    expect(
      (await core.reminders.mentioning("person", person.id)).map((r) => r.id),
    ).toEqual([reminder.id]);
  });

  it("re-dates the reminder in place when the birthday's date is edited", async () => {
    const { milestone } = await personWithBirthday(5);
    const before = (await systemReminders())[0];
    expect(daysUntil(todayCivil(), civilFromDueMs(before.dueDate!))).toBe(5);

    // Move the birthday later in the same window — the reminder id is stable, so
    // its due date must update rather than the stale "in 5 days" sticking.
    const later = civilDaysFromToday(19);
    await core.milestones.update(milestone.id, {
      month: later.month,
      day: later.day,
    });

    const after = (await systemReminders())[0];
    expect(after.id).toBe(before.id); // same reminder, re-dated in place
    expect(daysUntil(todayCivil(), civilFromDueMs(after.dueDate!))).toBe(19);
  });

  it("drops the reminder off the Home list when the birthday is deleted", async () => {
    const { person, milestone } = await personWithBirthday(8);
    expect(await systemReminders()).toHaveLength(1);

    await core.milestones.softDelete(milestone.id);

    expect(await systemReminders()).toHaveLength(0);
    // And it falls off the person's backlink too (mentions cleared on prune).
    expect(await core.reminders.mentioning("person", person.id)).toEqual([]);
  });

  it("prunes the reminder when the whole person is deleted (cascade reconcile)", async () => {
    const { person } = await personWithBirthday(6);
    expect(await systemReminders()).toHaveLength(1);

    // Deleting the person cascades away their birthday milestone; the reconcile
    // folded into people.softDelete drops the orphaned reminder in the same call.
    await core.people.softDelete(person.id);
    expect(await systemReminders()).toHaveLength(0);
  });
});
