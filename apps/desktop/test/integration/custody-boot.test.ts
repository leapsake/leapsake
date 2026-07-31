import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_KEY, createInMemoryKeyStore } from "@leapsake/crypto";
import { runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import {
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/db/open.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";
import { jsonFileStorage } from "../../src/main/db/roster-storage.js";

/**
 * The desktop boot **decision**, end to end: roster → `resolveActiveStore` → the
 * store actually opened. `open.test.ts` covers `openAppDatabase` in isolation; this
 * covers the wiring around it that `src/main/index.ts` performs, which is where the
 * custody state is really chosen.
 *
 * These are slices 1 and 2 of the custody build order expressed as tests: *a fresh
 * profile creates zero keychain entries and a readable plaintext store*, and *an
 * existing encrypted profile still opens normally*.
 */
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

/** The boot-path resolution `index.ts` runs before anything is opened. */
async function resolveBoot(userData: string) {
  const roster = createAccountRoster(
    jsonFileStorage(join(userData, ROSTER_PATH)),
  );
  const activeStore = resolveActiveStore({ accounts: await roster.list() });
  return { roster, activeStore, dbPath: join(userData, activeStore.path) };
}

describe("custody boot decision", () => {
  let userData: string;

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), "leapsake-custody-"));
  });
  afterEach(() => {
    rmSync(userData, { recursive: true, force: true });
  });

  it("a fresh profile is Unauthenticated: no keys, a plaintext store, usable app", async () => {
    const keyStore = createInMemoryKeyStore();
    const { activeStore, dbPath } = await resolveBoot(userData);

    expect(activeStore.custody).toBe("plaintext");
    // Derived from the layout, not a hardcoded `leapsake.db` (§7.4).
    expect(dbPath).toBe(join(userData, "stores", "local", "leapsake.db"));

    const driver = await openAppDatabase({
      dbPath,
      custody: activeStore.custody,
      keyStore,
      requestUnlock: never,
    });
    await runMigrations(driver);

    // The app genuinely works in this state — the whole point of Unauthenticated is that a
    // user can use Leapsake without ever being asked to set anything up.
    await createPeopleRepo(driver).create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    expect((await createPeopleRepo(driver).list()).length).toBe(1);
    await driver.close?.();

    // Zero keychain entries, and the file is plaintext on disk.
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    expect(existsSync(`${dbPath}.recovery`)).toBe(false);
    expect(storeFileState(dbPath)).toBe("plaintext");
  });

  it("keeps the Unauthenticated store across launches without ever minting a key", async () => {
    const keyStore = createInMemoryKeyStore();

    const first = await resolveBoot(userData);
    let driver = await openAppDatabase({
      dbPath: first.dbPath,
      custody: first.activeStore.custody,
      keyStore,
      requestUnlock: never,
    });
    await runMigrations(driver);
    await createPeopleRepo(driver).create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await driver.close?.();

    // Second launch: the same decision, the same store, still no keys.
    const second = await resolveBoot(userData);
    expect(second.activeStore.custody).toBe("plaintext");
    expect(second.dbPath).toBe(first.dbPath);
    driver = await openAppDatabase({
      dbPath: second.dbPath,
      custody: second.activeStore.custody,
      keyStore,
      requestUnlock: never,
    });
    expect((await createPeopleRepo(driver).list()).length).toBe(1);
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
  });

  // The pre-custody legacy branch was removed once dev installs became
  // recreatable (owner, 2026-07-27). What replaced it is a *refusal*: a store in
  // the wrong custody state is reported, never silently converted or shadowed by
  // a fresh empty one.
  it("refuses an encrypted store when no account claims it", async () => {
    const keyStore = createInMemoryKeyStore();
    const openPath = join(userData, "stores", "local", "leapsake.db");

    // Seed an encrypted store where the Unauthenticated store would live.
    const seeded = await openAppDatabase({
      dbPath: openPath,
      custody: "encrypted",
      keyStore,
      requestUnlock: never,
    });
    // Write, so the file is a real encrypted database rather than the 0-byte
    // placeholder SQLite leaves before the first write.
    await seeded.exec("CREATE TABLE t(x)");
    await seeded.close?.();

    const { activeStore, dbPath } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("plaintext");
    await expect(
      openAppDatabase({
        dbPath,
        custody: activeStore.custody,
        keyStore,
        requestUnlock: never,
      }),
    ).rejects.toThrow(/encrypted, but no account was found/);
  });

  // The mirror case: an account exists, but its store was never converted.
  it("refuses a plaintext store that an account claims", async () => {
    const { roster } = await resolveBoot(userData);
    await roster.add({
      id: "acct-1",
      username: "ada",
      createdAt: "2026-07-27T00:00:00.000Z",
    });
    const { activeStore, dbPath } = await resolveBoot(userData);

    // Write a plaintext store at the account's path — the state a half-finished
    // account creation would leave behind.
    const plaintext = await openAppDatabase({
      dbPath,
      custody: "plaintext",
      keyStore: createInMemoryKeyStore(),
      requestUnlock: never,
    });
    await plaintext.exec("CREATE TABLE t(x)");
    await plaintext.close?.();

    await expect(
      openAppDatabase({
        dbPath,
        custody: activeStore.custody,
        keyStore: createInMemoryKeyStore(),
        requestUnlock: never,
      }),
    ).rejects.toThrow(/unencrypted/);
  });

  it("opens a rostered account's own store, not the Unauthenticated one", async () => {
    const { roster } = await resolveBoot(userData);
    await roster.add({
      id: "acct-1",
      username: "ada",
      createdAt: "2026-07-27T00:00:00.000Z",
    });

    const { activeStore, dbPath } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("encrypted");
    expect(dbPath).toBe(join(userData, "stores", "acct-1", "leapsake.db"));
  });

  it("survives a corrupt roster by falling back to Unauthenticated", async () => {
    // Written before any UI exists to report an error, so this must not throw.
    await jsonFileStorage(join(userData, ROSTER_PATH)).write("{ not json");
    const { activeStore } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("plaintext");
  });
});
