import { DatabaseSync } from "node:sqlite";
import { generateKey } from "@leapsake/crypto";
import { runMigrations } from "@leapsake/data";
import { beforeEach, describe, expect, it } from "vitest";
import { syncableRepos } from "../src/sync.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * The canonical sync allowlist, pinned in production code. `syncableRepos` is the
 * single home for "what may leave the device"; adding an entity is the conscious
 * step of adding it here (the `defineSyncable` recipe). The device-local key
 * tables must *never* appear — that is what keeps sync zero-knowledge
 * (model.md §3). This mirrors the data-layer guard but over the real helper the
 * apps drive sync through.
 */
describe("syncableRepos — the canonical allowlist", () => {
  let tables: string[];

  beforeEach(async () => {
    const db = new DatabaseSync(":memory:");
    const driver = nodeSqliteDriver(db);
    await runMigrations(driver);
    tables = syncableRepos(driver, generateKey())
      .map((repo) => repo.table)
      .sort();
  });

  it("syncs exactly the opted-in tables", () => {
    expect(tables).toEqual([
      "email_addresses",
      "milestones",
      "not_a_duplicate",
      "people",
      "pets",
      "phone_numbers",
      "postal_addresses",
      "relationship_dismissals",
      "relationships",
      "taggings",
      "tags",
    ]);
  });

  it("never includes a device-local key or identity table", () => {
    for (const forbidden of [
      "content_key",
      "key_wrap",
      "sync_state",
      "account",
      "device",
    ]) {
      expect(tables).not.toContain(forbidden);
    }
  });
});
