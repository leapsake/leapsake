import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src/migrations.js";
import { createSyncStateRepo } from "../src/sync-state-repo.js";
import { nodeSqliteDriver } from "./node-sqlite-driver.js";

/**
 * The device-local watermark/preference store. These tests focus on the
 * "Sync automatically" preference, which is stored *inverted* (absent ⇒ enabled)
 * so a fresh install defaults to on. The engine watermark methods are exercised
 * by the sync engine integration test (`sync.test.ts`).
 */
describe("createSyncStateRepo — auto-sync preference", () => {
  let db: DatabaseSync;
  let repo: ReturnType<typeof createSyncStateRepo>;

  beforeEach(async () => {
    db = new DatabaseSync(":memory:");
    const driver = nodeSqliteDriver(db);
    await runMigrations(driver);
    repo = createSyncStateRepo(driver);
  });

  afterEach(() => {
    db.close();
  });

  it("defaults to enabled when the row is absent", async () => {
    expect(await repo.getAutoSyncEnabled()).toBe(true);
  });

  it("round-trips disabled and re-enabled", async () => {
    await repo.setAutoSyncEnabled(false);
    expect(await repo.getAutoSyncEnabled()).toBe(false);

    await repo.setAutoSyncEnabled(true);
    expect(await repo.getAutoSyncEnabled()).toBe(true);
  });

  it("persists across a fresh repo on the same database", async () => {
    await repo.setAutoSyncEnabled(false);
    const fresh = createSyncStateRepo(nodeSqliteDriver(db));
    expect(await fresh.getAutoSyncEnabled()).toBe(false);
  });
});
