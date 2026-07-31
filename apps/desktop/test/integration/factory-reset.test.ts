import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATABASE_KEY,
  createInMemoryKeyStore,
  equalBytes,
} from "@leapsake/crypto";
import { createPeopleRepo, runMigrations } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { factoryResetFiles } from "../../src/main/db/factory-reset.js";
import { openAppDatabase } from "../../src/main/db/open.js";

/**
 * Factory reset (desktop): the file half deletes every on-device surface, and the
 * next `openAppDatabase` then takes the fresh-install path — a new key over an
 * empty DB, "as if opening for the first time." The IPC handler that wires these
 * together (`app:factoryReset`) additionally re-opens the store in place and
 * reloads the renderer, which needs a running Electron app and so is out of scope
 * here; this verifies the teardown + reopen behavior directly.
 */
describe("factoryResetFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-reset-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("removes the database, its WAL/SHM sidecars, the recovery file, and the keystore", () => {
    const dbPath = join(dir, "leapsake.db");
    const keystorePath = join(dir, "keystore.json");
    const targets = [
      dbPath,
      `${dbPath}-wal`,
      `${dbPath}-shm`,
      `${dbPath}.recovery`,
      keystorePath,
      `${keystorePath}.tmp`,
    ];
    for (const path of targets) writeFileSync(path, "x");

    factoryResetFiles({ dbPath, keystorePath });

    for (const path of targets) expect(existsSync(path)).toBe(false);
  });

  it("ignores surfaces that are already absent (e.g. a store with no sidecar yet)", () => {
    const dbPath = join(dir, "leapsake.db");
    const keystorePath = join(dir, "keystore.json");
    writeFileSync(dbPath, "x"); // only the DB exists; no sidecar, no keystore

    expect(() => factoryResetFiles({ dbPath, keystorePath })).not.toThrow();
    expect(existsSync(dbPath)).toBe(false);
  });
});

const requestUnlock = () =>
  Promise.reject(new Error("should not prompt on a fresh install"));

describe("factory reset → fresh install round-trip", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-reset-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reopens with a new key and an empty database after the wipe", async () => {
    const dbPath = join(dir, "leapsake.db");
    const keystorePath = join(dir, "keystore.json");
    const keyStore = createInMemoryKeyStore();

    // First run: mint a key, migrate, and store some data.
    const driver = await openAppDatabase({
      dbPath,
      custody: "encrypted",
      keyStore,
      requestUnlock,
    });
    await runMigrations(driver);
    await createPeopleRepo(driver).create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect((await createPeopleRepo(driver).list()).length).toBe(1);
    const firstKey = await keyStore.getSecret(DATABASE_KEY);
    await driver.close?.();

    // Wipe the files. In production, deleting keystore.json (asserted above)
    // clears every secret; model that here by booting into a fresh, empty vault.
    factoryResetFiles({ dbPath, keystorePath });
    const freshKeyStore = createInMemoryKeyStore();

    // Next run: no key + no file → fresh install. New key, empty migrated DB.
    const reopened = await openAppDatabase({
      dbPath,
      custody: "encrypted",
      keyStore: freshKeyStore,
      requestUnlock,
    });
    await runMigrations(reopened);
    expect(await createPeopleRepo(reopened).list()).toEqual([]);

    const secondKey = await freshKeyStore.getSecret(DATABASE_KEY);
    if (firstKey === undefined || secondKey === undefined) {
      throw new Error("expected a database key on both launches");
    }
    expect(equalBytes(firstKey, secondKey)).toBe(false);
    await reopened.close?.();
  });
});
