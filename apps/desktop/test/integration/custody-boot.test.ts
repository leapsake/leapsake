import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATABASE_KEY, createInMemoryKeyStore } from "@leapsake/crypto";
import { runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import {
  LEGACY_STORE_PATH,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppDatabase } from "../../src/main/db/open.js";
import { isPlaintextSqlite } from "../../src/main/db/plaintext-migration.js";
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
  const activeStore = resolveActiveStore({
    accounts: await roster.list(),
    legacyStorePresent: existsSync(join(userData, LEGACY_STORE_PATH)),
  });
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

  it("a fresh profile is Open: no keys, a plaintext store, usable app", async () => {
    const keyStore = createInMemoryKeyStore();
    const { activeStore, dbPath } = await resolveBoot(userData);

    expect(activeStore.custody).toBe("open");
    // Derived from the layout, not a hardcoded `leapsake.db` (§7.4).
    expect(dbPath).toBe(join(userData, "stores", "local", "leapsake.db"));

    const driver = await openAppDatabase({
      dbPath,
      custody: activeStore.custody,
      keyStore,
      requestRecoveryPhrase: never,
    });
    await runMigrations(driver);

    // The app genuinely works in this state — the whole point of Open is that a
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
    expect(isPlaintextSqlite(dbPath)).toBe(true);
  });

  it("keeps the Open store across launches without ever minting a key", async () => {
    const keyStore = createInMemoryKeyStore();

    const first = await resolveBoot(userData);
    let driver = await openAppDatabase({
      dbPath: first.dbPath,
      custody: first.activeStore.custody,
      keyStore,
      requestRecoveryPhrase: never,
    });
    await runMigrations(driver);
    await createPeopleRepo(driver).create({
      firstName: "Grace",
      lastName: "Hopper",
    });
    await driver.close?.();

    // Second launch: the same decision, the same store, still no keys.
    const second = await resolveBoot(userData);
    expect(second.activeStore.custody).toBe("open");
    expect(second.dbPath).toBe(first.dbPath);
    driver = await openAppDatabase({
      dbPath: second.dbPath,
      custody: second.activeStore.custody,
      keyStore,
      requestRecoveryPhrase: never,
    });
    expect((await createPeopleRepo(driver).list()).length).toBe(1);
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
  });

  // The constraint the build order calls out explicitly: dev installs are already
  // encrypted at the old path and must keep opening. Getting this wrong doesn't
  // error — it silently shows the user an empty app beside their real data.
  it("a pre-custody encrypted profile still opens, in place", async () => {
    const keyStore = createInMemoryKeyStore();
    const legacyPath = join(userData, LEGACY_STORE_PATH);

    // Seed a pre-custody install: encrypted, at the bare `leapsake.db` path.
    const seeded = await openAppDatabase({
      dbPath: legacyPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
    });
    await runMigrations(seeded);
    await createPeopleRepo(seeded).create({
      firstName: "Ada",
      lastName: "Lovelace",
    });
    await seeded.close?.();
    expect(isPlaintextSqlite(legacyPath)).toBe(false);

    // Boot under the new layout: it must find that store, not start a new one.
    const { activeStore, dbPath } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("protected");
    expect(dbPath).toBe(legacyPath);

    const driver = await openAppDatabase({
      dbPath,
      custody: activeStore.custody,
      keyStore,
      requestRecoveryPhrase: never,
    });
    const people = await createPeopleRepo(driver).list();
    expect(people.length).toBe(1);
    expect(people[0].firstName).toBe("Ada");
  });

  it("opens a rostered account's own store, not the Open one", async () => {
    const { roster } = await resolveBoot(userData);
    await roster.add({
      id: "acct-1",
      username: "ada",
      createdAt: "2026-07-27T00:00:00.000Z",
    });

    const { activeStore, dbPath } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("protected");
    expect(dbPath).toBe(join(userData, "stores", "acct-1", "leapsake.db"));
  });

  it("survives a corrupt roster by falling back to Open", async () => {
    // Written before any UI exists to report an error, so this must not throw.
    await jsonFileStorage(join(userData, ROSTER_PATH)).write("{ not json");
    const { activeStore } = await resolveBoot(userData);
    expect(activeStore.custody).toBe("open");
  });
});
