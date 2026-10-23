import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { todayCivil } from "@leapsake/schema";
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

async function reminderTitles(term: string): Promise<string[]> {
  const hits = await core.search.query(term);
  return hits.filter((h) => h.entityType === "reminder").map((h) => h.title);
}

describe("core.search — reminders", () => {
  it("finds an occasion's reminder, worded as the list words it", async () => {
    const violet = await core.people.create(
      { firstName: "Violet", middleName: null, lastName: "Bick", gender: null },
      [],
    );
    const today = todayCivil();
    await core.milestones.create({
      kind: "birthday",
      bearerType: "person",
      bearerId: violet.id,
      month: today.month,
      day: today.day,
    });

    expect(await reminderTitles("happy birthday")).toEqual([
      "🎉 Wish Violet Bick a happy birthday",
    ]);
  });

  it("finds a snoozed reminder, carrying when it comes back", async () => {
    const r = await core.reminders.create({ title: "Renew the passport" });
    await core.reminders.snooze(r.id, 3);

    const [hit] = await core.search.query("passport");
    expect(hit.entityId).toBe(r.id);
    expect(hit.reminder?.snoozedUntil).not.toBeNull();
  });

  it("does not find the app's own to-dos", async () => {
    await core.reminders.regenerateSystem();
    const listed = await core.reminders.listInWindow();
    expect(listed.some((r) => r.title === "📇 Import your contacts")).toBe(
      true,
    );

    expect(await reminderTitles("import your contacts")).toEqual([]);
  });
});
