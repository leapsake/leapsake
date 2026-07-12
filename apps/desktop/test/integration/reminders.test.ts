import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  runMigrations,
} from "@leapsake/core";
import { createTagsRepo } from "@leapsake/data";
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

/** The tags a reminder currently bears, via the shared taggings graph. */
function reminderTags(id: string) {
  return createTagsRepo(driver).listForEntity("reminder", id);
}

describe("core.reminders", () => {
  it("creates a plaintext reminder, defaulting source to 'user'", async () => {
    const r = await core.reminders.create({ title: "Call mom" });
    expect(r.source).toBe("user");
    expect(r.completedAt).toBeNull();

    // Plaintext at rest (no ciphertext column): the title is stored as-is.
    const row = await driver.get<{ title: string | null; source: string }>(
      "SELECT title, source FROM reminders WHERE id = ?",
      [r.id],
    );
    expect(row?.title).toBe("Call mom");
    expect(row?.source).toBe("user");
  });

  it("parses inline #tags from title+body into taggings under bearer 'reminder'", async () => {
    const r = await core.reminders.create({
      title: "Buy gift #birthday",
      body: "ask about the trip #family",
    });

    const tags = await reminderTags(r.id);
    expect(tags.map((t) => t.name).toSorted()).toEqual(["birthday", "family"]);

    // The join row records the polymorphic bearer as the reminder.
    const row = await driver.get<{ bearer_type: string }>(
      "SELECT bearer_type FROM taggings WHERE bearer_id = ? LIMIT 1",
      [r.id],
    );
    expect(row?.bearer_type).toBe("reminder");
  });

  it("re-derives tags from the edited text (the text is the source of truth)", async () => {
    const r = await core.reminders.create({ body: "call #plumber #urgent" });
    expect((await reminderTags(r.id)).map((t) => t.name).toSorted()).toEqual([
      "plumber",
      "urgent",
    ]);

    await core.reminders.update(r.id, { body: "call the #plumber, done soon" });
    expect((await reminderTags(r.id)).map((t) => t.name)).toEqual(["plumber"]);
  });

  it("setCompleted toggles completedAt in both directions", async () => {
    const r = await core.reminders.create({ title: "ship it" });

    const done = await core.reminders.setCompleted(r.id, true);
    expect(done?.completedAt).not.toBeNull();

    const reopened = await core.reminders.setCompleted(r.id, false);
    expect(reopened?.completedAt).toBeNull();
  });

  it("softDelete tombstones the reminder and cascades its taggings", async () => {
    const r = await core.reminders.create({ body: "fix the #sink" });
    expect(await reminderTags(r.id)).toHaveLength(1);

    await core.reminders.softDelete(r.id);

    expect(await core.reminders.get(r.id)).toBeUndefined();
    expect(await reminderTags(r.id)).toHaveLength(0);
    // "#sink" was unique to this reminder → its now-orphaned tag is soft-deleted.
    const sink = await driver.get<{ deleted_at: number | null }>(
      "SELECT deleted_at FROM tags WHERE normalized = 'sink'",
    );
    expect(sink!.deleted_at).not.toBeNull();
  });

  it("shares a #tag with a person via the same taggings graph", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", middleName: null, lastName: "Doe", gender: null },
      ["family"],
    );
    const r = await core.reminders.create({ title: "call sister #family" });

    // The reminder and the person carry the *same* shared tag row.
    const tagId = (await reminderTags(r.id))[0]?.id;
    const janeTag = (await core.tags.listForPerson(jane.id))[0];
    expect(tagId).toBe(janeTag?.id);
  });

  it("surfaces a tagged reminder on the tag's page, and drops it when deleted", async () => {
    const jane = await core.people.create(
      { firstName: "Jane", middleName: null, lastName: "Doe", gender: null },
      ["family"],
    );
    const r = await core.reminders.create({ title: "call sister #family" });
    const tagId = (await reminderTags(r.id))[0]!.id;

    // The reminder lists on the tag's page, and doesn't displace the person.
    expect((await core.tags.remindersForTag(tagId)).map((x) => x.id)).toEqual([
      r.id,
    ]);
    expect((await core.tags.peopleForTag(tagId)).map((p) => p.id)).toEqual([
      jane.id,
    ]);

    // A soft-deleted reminder falls off the tag page.
    await core.reminders.softDelete(r.id);
    expect(await core.tags.remindersForTag(tagId)).toEqual([]);
  });

  it("lists reminders, distinguishing open from completed via completedAt", async () => {
    const a = await core.reminders.create({ title: "open one" });
    const b = await core.reminders.create({ title: "done one" });
    await core.reminders.setCompleted(b.id, true);

    const all = await core.reminders.list();
    expect(all.map((r) => r.id).toSorted()).toEqual([a.id, b.id].toSorted());
    expect(all.find((r) => r.id === a.id)?.completedAt).toBeNull();
    expect(all.find((r) => r.id === b.id)?.completedAt).not.toBeNull();
  });
});
