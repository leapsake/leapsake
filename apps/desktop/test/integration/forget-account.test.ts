import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
} from "@leapsake/crypto";
import { runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import {
  UNAUTHENTICATED_STORE_SLOT,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
  storeDir,
  storePath,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccountOnThisDevice } from "../../src/main/db/create-account-flow.js";
import { forgetAccountOnThisDevice } from "../../src/main/db/forget-account-flow.js";
import { openAppDatabase } from "../../src/main/db/open.js";
import { jsonFileStorage } from "../../src/main/db/roster-storage.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";

/**
 * **Forget account** (`model.md` §7.3), slice 7's second half: this account and
 * its data are removed from this device.
 *
 * Two properties carry the weight. *Nothing survives it* — not the store, not
 * either door, not the keys, because a door outliving the store it opened is how
 * "deleted" quietly becomes "still there". And *the device is genuinely Unauthenticated
 * afterwards*, i.e. back in the accountless state a fresh install is in, which is
 * the acceptance that separates this from a factory reset that happens to work.
 */
const PASSWORD = "correct-horse-battery";
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

let userData: string;
let keyStore: ReturnType<typeof createInMemoryKeyStore>;

const rosterFor = (dir: string) =>
  createAccountRoster(jsonFileStorage(join(dir, ROSTER_PATH)));

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "leapsake-forget-"));
  keyStore = createInMemoryKeyStore();
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/** A device holding one account, its encrypted store, both doors, and data. */
async function deviceWithAccount(): Promise<{
  accountId: string;
  dbPath: string;
}> {
  const openPath = join(userData, storePath(UNAUTHENTICATED_STORE_SLOT));
  const driver = await openAppDatabase({
    dbPath: openPath,
    custody: "plaintext",
    keyStore,
    requestUnlock: never,
  });
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Mary",
    lastName: "Bailey",
  });
  const { accountId } = await createAccountOnThisDevice({
    keyStore,
    driver,
    roster: rosterFor(userData),
    userDataPath: userData,
    username: "mary",
    password: PASSWORD,
    closeStore: async () => {
      await driver.close?.();
    },
  });

  // The first Authenticated open writes the recovery sidecar, so the device under
  // test has both doors, as a real one does by the time Settings is reachable.
  const dbPath = join(userData, storePath(accountId));
  const opened = await openAppDatabase({
    dbPath,
    custody: "encrypted",
    keyStore,
    requestUnlock: never,
  });
  await opened.close?.();
  return { accountId, dbPath };
}

const forget = (accountId: string) =>
  forgetAccountOnThisDevice({
    keyStore,
    roster: rosterFor(userData),
    userDataPath: userData,
    accountId,
    closeStore: async () => {},
  });

describe("forget account", () => {
  it("removes the store and both of its unlock doors", async () => {
    const { accountId, dbPath } = await deviceWithAccount();
    expect(existsSync(`${dbPath}.password`)).toBe(true);
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);

    await forget(accountId);

    // The directory, not a list of filenames — that is what guarantees no door
    // (or WAL/SHM leftover) outlives the store it belonged to.
    expect(existsSync(join(userData, storeDir(accountId)))).toBe(false);
  });

  it("drops the roster entry, so the next boot is Unauthenticated again", async () => {
    const { accountId } = await deviceWithAccount();

    await forget(accountId);

    expect(await rosterFor(userData).list()).toEqual([]);
    const resolved = resolveActiveStore({
      accounts: await rosterFor(userData).list(),
    });
    expect(resolved.custody).toBe("plaintext");
    expect(resolved.path).toBe(storePath(UNAUTHENTICATED_STORE_SLOT));
  });

  it("clears the keys that opened it", async () => {
    const { accountId } = await deviceWithAccount();
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();

    await forget(accountId);

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
  });

  // The acceptance: the result has to be a *launchable, genuinely accountless*
  // device — the fresh-install state (§7.2) — not merely a device missing files.
  it("leaves a device the Unauthenticated boot path opens, keyless and empty", async () => {
    const { accountId } = await deviceWithAccount();
    await forget(accountId);

    const resolved = resolveActiveStore({
      accounts: await rosterFor(userData).list(),
    });
    const dbPath = join(userData, resolved.path);
    const reopened = await openAppDatabase({
      dbPath,
      custody: resolved.custody,
      keyStore,
      requestUnlock: never,
    });
    await runMigrations(reopened);

    expect(storeFileState(dbPath)).toBe("plaintext");
    expect(await createPeopleRepo(reopened).list()).toEqual([]);
    // Unauthenticated means *no keys at all*, so forgetting must not have left one behind
    // for the new store to be silently encrypted under.
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    await reopened.close?.();
  });

  // Why this is scoped rather than `factoryResetFiles` with a shorter argument
  // list: factory reset erases the whole `stores/` tree, which for a device
  // holding a second account would delete data the user never asked to lose.
  it("touches no other account's store", async () => {
    const { accountId } = await deviceWithAccount();
    const otherId = "11111111-2222-3333-4444-555555555555";
    const otherDir = join(userData, storeDir(otherId));
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, "leapsake.db"), "someone else's ciphertext");
    await rosterFor(userData).add({
      id: otherId,
      username: "henry",
      createdAt: new Date().toISOString(),
    });

    await forget(accountId);

    expect(existsSync(join(otherDir, "leapsake.db"))).toBe(true);
    expect((await rosterFor(userData).list()).map((a) => a.username)).toEqual([
      "henry",
    ]);
  });

  it("refuses an account this device does not hold", async () => {
    await deviceWithAccount();

    await expect(forget("not-an-account-on-this-device")).rejects.toThrow(
      /not on this device/,
    );
    // And it refused *before* touching anything.
    expect((await rosterFor(userData).list()).length).toBe(1);
  });
});
