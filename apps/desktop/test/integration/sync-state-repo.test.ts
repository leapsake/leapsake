import {
  type SqliteDriver,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The device-local watermark/preference store. These tests focus on the
 * "Sync automatically" preference, which is stored *inverted* (absent ⇒ enabled)
 * so a fresh install defaults to on. The engine watermark methods are exercised
 * by the sync engine integration test (`sync.test.ts`).
 */
describe("createSyncStateRepo — auto-sync preference", () => {
  let reopen: () => SqliteDriver;
  let cleanup: () => void;
  let repo: ReturnType<typeof createSyncStateRepo>;

  beforeEach(async () => {
    let driver: SqliteDriver;
    ({ driver, reopen, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
    repo = createSyncStateRepo(driver);
  });

  afterEach(() => {
    cleanup();
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
    const fresh = createSyncStateRepo(reopen());
    expect(await fresh.getAutoSyncEnabled()).toBe(false);
  });
});
