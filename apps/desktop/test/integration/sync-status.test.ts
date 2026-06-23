import { createInMemoryKeyStore } from "@leapsake/crypto";
import { type SqliteDriver, runMigrations } from "@leapsake/data";
import {
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
} from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The status probe a client's onboarding UI branches on: not-enabled before
 * {@link enableSync}, enabled (with the account identity, no secrets) after.
 */
describe("getSyncStatus", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => {
    cleanup();
  });

  it("reports not enabled before sync is enabled", async () => {
    expect(await getSyncStatus({ driver })).toEqual({ enabled: false });
  });

  it("reports enabled with the account identity after enableSync", async () => {
    const keyStore = createInMemoryKeyStore();
    await ensureDeviceMasterKey({ keyStore, driver });
    const { account } = await enableSync({
      keyStore,
      driver,
      password: "correct horse battery staple",
      platform: "desktop",
    });

    const status = await getSyncStatus({ driver });
    expect(status.enabled).toBe(true);
    expect(status.accountId).toBe(account.id);
    expect(status.createdAt).toBe(account.createdAt);
  });
});
