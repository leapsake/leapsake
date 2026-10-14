import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type CoreApi,
  type SqliteDriver,
  createCore,
  enableSync,
  ensureDeviceMasterKey,
  runMigrations,
} from "@leapsake/core";
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

const name = (firstName: string, lastName: string | null = "Bailey") => ({
  firstName,
  middleName: null,
  lastName,
  gender: null,
});

/** A draft person with a birthday today, as the Add screen gathers one. */
async function draftWithBirthday() {
  const draft = await core.people.create(
    { ...name("Zuzu"), standing: "draft" },
    [],
  );
  const today = new Date();
  await core.milestones.create({
    kind: "birthday",
    bearerType: "person",
    bearerId: draft.id,
    month: today.getMonth() + 1,
    day: today.getDate(),
  });
  return draft;
}

async function count(table: string, where: string, params: unknown[] = []) {
  const [row] = await driver.all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`,
    params,
  );
  return row?.n ?? 0;
}

async function remindersAbout(id: string) {
  return (await core.reminders.listInWindow()).filter((r) =>
    `${r.title ?? ""}${r.body ?? ""}`.includes(id),
  );
}

describe("a draft person", () => {
  it("stays out of the roster and search", async () => {
    await draftWithBirthday();
    expect(await core.people.list()).toEqual([]);
    expect(await core.search.query("Zuzu")).toEqual([]);
  });

  it("is not published by gaining a fact", async () => {
    const draft = await draftWithBirthday();
    expect((await core.people.get(draft.id))?.standing).toBe("draft");
  });

  it("raises no reminders until it is saved", async () => {
    const draft = await draftWithBirthday();
    await core.reminders.regenerateSystem();
    expect(await remindersAbout(draft.id)).toEqual([]);

    await core.drafts.publish("person", draft.id, {});
    await core.reminders.regenerateSystem();
    expect(await remindersAbout(draft.id)).not.toEqual([]);
  });

  it("does not show on a published person's relationships", async () => {
    const mary = await core.people.create(name("Mary"), []);
    const draft = await core.people.create(
      { ...name("Zuzu"), standing: "draft" },
      [],
    );
    await core.relationships.create({
      aType: "person",
      aId: mary.id,
      aRole: "parent",
      bType: "person",
      bId: draft.id,
      bRole: "child",
    });

    expect((await core.views.person(mary.id))?.relationships).toEqual([]);
    expect(
      (await core.views.person(draft.id))?.relationships.map((r) => r.otherId),
    ).toEqual([mary.id]);
  });

  it("joins the roster once saved", async () => {
    const draft = await draftWithBirthday();
    await core.drafts.publish("person", draft.id, { firstName: "Zuzu" });
    expect((await core.people.list()).map((p) => p.id)).toEqual([draft.id]);
  });
});

describe("discarding a draft", () => {
  it("removes every trace of it when there is no account", async () => {
    const other = await core.people.create(name("Harry"), []);
    await core.people.softDelete(other.id);
    const draft = await draftWithBirthday();

    await core.drafts.discard("person", draft.id);

    expect(await count("people", "id = ?", [draft.id])).toBe(0);
    expect(await count("milestones", "bearer_id = ?", [draft.id])).toBe(0);
    // An older tombstone is not the draft's to remove.
    expect(await count("people", "id = ?", [other.id])).toBe(1);
  });

  it("leaves tombstones when there is an account to sync them", async () => {
    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    await enableSync({
      keyStore,
      driver,
      password: "correct horse battery staple",
      platform: "desktop",
    });
    const draft = await draftWithBirthday();

    await core.drafts.discard("person", draft.id);

    expect(await core.people.get(draft.id)).toBeUndefined();
    expect(
      await count("people", "id = ? AND deleted_at IS NOT NULL", [draft.id]),
    ).toBe(1);
    expect(
      await count("milestones", "bearer_id = ? AND deleted_at IS NOT NULL", [
        draft.id,
      ]),
    ).toBe(1);
  });

  it("never discards a saved person", async () => {
    const mary = await core.people.create(name("Mary"), []);
    await core.drafts.discard("person", mary.id);
    expect((await core.people.list()).map((p) => p.id)).toEqual([mary.id]);
  });

  it("clears every draft left behind, and nothing else", async () => {
    const mary = await core.people.create(name("Mary"), []);
    await draftWithBirthday();
    await core.pets.create({ name: "Jimmy", standing: "draft" }, []);

    await core.drafts.discardAll();

    expect(await count("people", "1")).toBe(1);
    expect(await count("pets", "1")).toBe(0);
    expect((await core.people.list()).map((p) => p.id)).toEqual([mary.id]);
  });
});
