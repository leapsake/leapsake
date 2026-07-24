import {
  type CoreApi,
  type SqliteDriver,
  createCore,
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

describe("core.gifts.ideas", () => {
  it("creates, lists, updates, and removes a gift idea", async () => {
    expect(await core.gifts.ideas.list()).toEqual([]);

    const created = await core.gifts.ideas.create({
      title: "Red Ryder BB Gun",
      url: "https://example.com/bb-gun",
    });
    expect(created.title).toBe("Red Ryder BB Gun");
    expect(created.url).toBe("https://example.com/bb-gun");
    expect(created.notes).toBeNull();

    expect(await core.gifts.ideas.get(created.id)).toEqual(created);
    expect((await core.gifts.ideas.list()).map((i) => i.id)).toEqual([
      created.id,
    ]);

    const updated = await core.gifts.ideas.update(created.id, {
      notes: "the 200-shot model",
    });
    expect(updated?.notes).toBe("the 200-shot model");

    await core.gifts.ideas.softDelete(created.id);
    expect(await core.gifts.ideas.get(created.id)).toBeUndefined();
    expect(await core.gifts.ideas.list()).toEqual([]);
  });

  it("lists ideas newest-first", async () => {
    const socks = await core.gifts.ideas.create({ title: "Socks" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const scarf = await core.gifts.ideas.create({ title: "Scarf" });

    expect((await core.gifts.ideas.list()).map((i) => i.title)).toEqual([
      "Scarf",
      "Socks",
    ]);
    expect(scarf.createdAt).toBeGreaterThanOrEqual(socks.createdAt);
  });
});
