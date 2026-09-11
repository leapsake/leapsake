import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type GiftIdeasRepo,
  type SqliteDriver,
  createGiftIdeasRepo,
  runMigrations,
} from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

let driver: SqliteDriver;
let cleanup: () => void;
let repo: GiftIdeasRepo;

beforeEach(async () => {
  ({ driver, cleanup } = makeEncryptedTestDriver());
  await runMigrations(driver);
  repo = createGiftIdeasRepo(driver);
});

afterEach(() => {
  cleanup();
});

describe("giftIdeasRepo", () => {
  it("creates an idea with a uuid, timestamps, and null optionals", async () => {
    const idea = await repo.create({ title: "The Adventures of Tom Sawyer" });
    expect(idea.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(idea.title).toBe("The Adventures of Tom Sawyer");
    expect(idea.url).toBeNull();
    expect(idea.notes).toBeNull();
    expect(idea.createdAt).toBeGreaterThan(0);
    expect(idea.updatedAt).toBe(idea.createdAt);
    expect(idea.deletedAt).toBeNull();
  });

  it("persists url and notes when provided", async () => {
    const idea = await repo.create({
      title: "Tom Sawyer",
      url: "https://example.com/tom-sawyer",
      notes: "the 200-shot model",
    });
    const fetched = await repo.get(idea.id);
    expect(fetched?.url).toBe("https://example.com/tom-sawyer");
    expect(fetched?.notes).toBe("the 200-shot model");
  });

  it("lists ideas newest-first, excluding soft-deleted ones", async () => {
    const first = await repo.create({ title: "Socks" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await repo.create({ title: "Scarf" });

    const list = await repo.list();
    expect(list.map((i) => i.id)).toEqual([second.id, first.id]);

    await repo.softDelete(second.id);
    expect((await repo.list()).map((i) => i.id)).toEqual([first.id]);
  });

  it("updates fields and bumps updatedAt", async () => {
    const idea = await repo.create({ title: "Scarf" });
    await new Promise((resolve) => setTimeout(resolve, 2));

    const updated = await repo.update(idea.id, {
      title: "Wool scarf",
      url: "https://example.com",
    });
    expect(updated?.title).toBe("Wool scarf");
    expect(updated?.url).toBe("https://example.com");
    expect(updated?.updatedAt).toBeGreaterThan(idea.updatedAt);
    expect(updated?.createdAt).toBe(idea.createdAt);
  });

  it("clears url/notes back to null on update", async () => {
    const idea = await repo.create({
      title: "Scarf",
      url: "https://example.com",
      notes: "n",
    });
    const updated = await repo.update(idea.id, { url: null, notes: null });
    expect(updated?.url).toBeNull();
    expect(updated?.notes).toBeNull();
  });

  it("hides a soft-deleted idea from get", async () => {
    const idea = await repo.create({ title: "Scarf" });
    await repo.softDelete(idea.id);
    expect(await repo.get(idea.id)).toBeUndefined();
  });
});
