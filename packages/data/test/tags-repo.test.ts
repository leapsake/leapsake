import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type SqliteDriver } from "../src/driver.js";
import { runMigrations } from "../src/migrations.js";
import { type TagsRepo, createTagsRepo } from "../src/tags-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

let db: DatabaseSync;
let driver: SqliteDriver;
let repo: TagsRepo;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  driver = nodeSqliteDriver(db);
  await runMigrations(driver);
  repo = createTagsRepo(driver);
});

afterEach(() => {
  db.close();
});

/** Count rows in a table (including soft-deleted) for white-box assertions. */
function countRows(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}

describe("tagsRepo", () => {
  it("creates and applies tags to an entity", async () => {
    await repo.setEntityTags("person", "p1", ["Friend", "Colleague"]);

    const tags = await repo.listForEntity("person", "p1");
    expect(tags.map((t) => t.name).toSorted()).toEqual(["Colleague", "Friend"]);
    expect(tags[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("dedupes tags case-insensitively, keeping the first spelling", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p2", ["friend", " FRIEND "]);

    const p1 = await repo.listForEntity("person", "p1");
    const p2 = await repo.listForEntity("person", "p2");
    expect(p1).toHaveLength(1);
    expect(p2).toHaveLength(1);
    // Same shared tag row, first spelling ("Friend") preserved.
    expect(p2[0]?.id).toBe(p1[0]?.id);
    expect(p2[0]?.name).toBe("Friend");
    expect(countRows("tags")).toBe(1);
  });

  it("treats re-applying an existing tag as a no-op", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p1", ["Friend"]);

    expect(await repo.listForEntity("person", "p1")).toHaveLength(1);
    // No extra active tagging rows created.
    expect(countRows("taggings")).toBe(1);
  });

  it("removes a dropped tag and soft-deletes its now-orphaned tag", async () => {
    await repo.setEntityTags("person", "p1", ["Friend", "Colleague"]);
    await repo.setEntityTags("person", "p1", ["Friend"]);

    const tags = await repo.listForEntity("person", "p1");
    expect(tags.map((t) => t.name)).toEqual(["Friend"]);
    // "Colleague" tag has no active taggings, so it is soft-deleted (not gone).
    expect(await repo.get(tags[0]?.id as string)).toBeDefined();
    const colleague = db
      .prepare("SELECT deleted_at FROM tags WHERE normalized = 'colleague'")
      .get() as { deleted_at: number | null };
    expect(colleague.deleted_at).not.toBeNull();
  });

  it("keeps a shared tag alive while another entity still uses it", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p2", ["Friend"]);

    // p1 drops Friend; p2 still has it, so the tag survives.
    await repo.setEntityTags("person", "p1", []);

    expect(await repo.listForEntity("person", "p1")).toHaveLength(0);
    const p2 = await repo.listForEntity("person", "p2");
    expect(p2).toHaveLength(1);
    expect(await repo.get(p2[0]?.id as string)).toBeDefined();
  });

  it("keeps a tag shared across unlike entity types", async () => {
    await repo.setEntityTags("person", "p1", ["Important"]);
    await repo.setEntityTags("place", "x1", ["important"]);

    await repo.setEntityTags("person", "p1", []);

    // The place still references the (single, shared) tag.
    const place = await repo.listForEntity("place", "x1");
    expect(place).toHaveLength(1);
    expect(await repo.get(place[0]?.id as string)).toBeDefined();
  });

  it("removeAllForEntity clears that entity's taggings and GCs orphans", async () => {
    await repo.setEntityTags("person", "p1", ["Friend", "Family"]);
    await repo.setEntityTags("person", "p2", ["Friend"]);

    await repo.removeAllForEntity("person", "p1");

    expect(await repo.listForEntity("person", "p1")).toHaveLength(0);
    // "Family" was unique to p1 -> soft-deleted; "Friend" survives via p2.
    const family = db
      .prepare("SELECT deleted_at FROM tags WHERE normalized = 'family'")
      .get() as { deleted_at: number | null };
    expect(family.deleted_at).not.toBeNull();
    expect(await repo.listForEntity("person", "p2")).toHaveLength(1);
  });

  it("entityIdsForTag returns only active taggings of the requested type", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p2", ["Friend"]);
    await repo.setEntityTags("place", "x1", ["Friend"]);
    const tagId = (await repo.listForEntity("person", "p1"))[0]?.id as string;

    expect((await repo.entityIdsForTag(tagId, "person")).toSorted()).toEqual([
      "p1",
      "p2",
    ]);
    expect(await repo.entityIdsForTag(tagId, "place")).toEqual(["x1"]);

    await repo.setEntityTags("person", "p1", []);
    expect(await repo.entityIdsForTag(tagId, "person")).toEqual(["p2"]);
  });

  it("softDelete removes the tag from every tagged entity", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p2", ["Friend"]);
    await repo.setEntityTags("pet", "x1", ["Friend"]);
    const tagId = (await repo.listForEntity("person", "p1"))[0]?.id as string;

    await repo.softDelete(tagId);

    expect(await repo.get(tagId)).toBeUndefined();
    expect(await repo.listForEntity("person", "p1")).toHaveLength(0);
    expect(await repo.listForEntity("person", "p2")).toHaveLength(0);
    expect(await repo.listForEntity("pet", "x1")).toHaveLength(0);
    expect(await repo.entityIdsForTag(tagId, "person")).toEqual([]);
  });

  it("excludes soft-deleted taggings from listForEntity", async () => {
    await repo.setEntityTags("person", "p1", ["Friend"]);
    await repo.setEntityTags("person", "p1", []);
    expect(await repo.listForEntity("person", "p1")).toHaveLength(0);
  });

  it("get returns undefined for a missing or soft-deleted tag", async () => {
    expect(await repo.get(crypto.randomUUID())).toBeUndefined();

    await repo.setEntityTags("person", "p1", ["Friend"]);
    const tagId = (await repo.listForEntity("person", "p1"))[0]?.id as string;
    await repo.setEntityTags("person", "p1", []); // orphans + soft-deletes it
    expect(await repo.get(tagId)).toBeUndefined();
  });
});
