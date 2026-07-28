import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATABASE_KEY,
  createInMemoryKeyStore,
  decodeRecoveryPhrase,
} from "@leapsake/crypto";
import { type SqliteDriver, runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import {
  OPEN_STORE_SLOT,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAccountOnThisDevice } from "../../src/main/db/create-account-flow.js";
import { openAppDatabase } from "../../src/main/db/open.js";
import { jsonFileStorage } from "../../src/main/db/roster-storage.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";

/**
 * **Account creation** (`model.md` §7.2.1) — the act that turns encryption on,
 * end to end: an Open store with real data goes in, an encrypted per-account store
 * comes out, the roster names it, and no plaintext survives.
 *
 * This is slice 4's acceptance, and the last case is the one worth the most: the
 * result has to be *launchable by the ordinary boot path*, not merely readable.
 */
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

let userData: string;
let keyStore: ReturnType<typeof createInMemoryKeyStore>;

const rosterFor = (dir: string) =>
  createAccountRoster(jsonFileStorage(join(dir, ROSTER_PATH)));

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), "leapsake-create-acct-"));
  keyStore = createInMemoryKeyStore();
});
afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

/** An Open store holding one person — the state a user is in before signing up. */
async function openStoreWithData(): Promise<{
  driver: SqliteDriver;
  path: string;
}> {
  const path = join(userData, storePath(OPEN_STORE_SLOT));
  const driver = await openAppDatabase({
    dbPath: path,
    custody: "open",
    keyStore,
    requestRecoveryPhrase: never,
  });
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Ada",
    lastName: "Lovelace",
  });
  return { driver, path };
}

async function createAccount(driver: SqliteDriver) {
  return createAccountOnThisDevice({
    keyStore,
    driver,
    roster: rosterFor(userData),
    userDataPath: userData,
    username: "ada",
    password: "correct-horse-battery",
    closeStore: async () => {
      await driver.close?.();
    },
  });
}

describe("account creation", () => {
  it("turns the Open store into an encrypted per-account store", async () => {
    const { driver, path: openPath } = await openStoreWithData();

    const { accountId, storePath: encryptedPath } = await createAccount(driver);

    expect(encryptedPath).toBe(join(userData, storePath(accountId)));
    expect(storeFileState(encryptedPath)).toBe("encrypted");

    // Acceptance: plaintext store in, encrypted store out, original gone.
    expect(existsSync(openPath)).toBe(false);
    expect(existsSync(join(userData, "stores", OPEN_STORE_SLOT))).toBe(false);
    // `.plaintext.bak` cannot exist — the code that wrote it was deleted with the
    // pre-Stage-2 migration — but assert it, since §8.1 calls it out by name.
    expect(existsSync(`${openPath}.plaintext.bak`)).toBe(false);
  });

  it("mints the db-key that was deliberately absent while Open", async () => {
    const { driver } = await openStoreWithData();
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();

    await createAccount(driver);

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();
  });

  it("returns a usable 24-word recovery phrase, once", async () => {
    const { driver } = await openStoreWithData();
    const { recoveryPhrase } = await createAccount(driver);

    expect(recoveryPhrase.split(/\s+/).length).toBe(24);
    // It decodes to real key material rather than being decorative.
    expect(decodeRecoveryPhrase(recoveryPhrase).length).toBe(32);
  });

  it("records the account in the roster, so the next boot is Protected", async () => {
    const { driver } = await openStoreWithData();
    const { accountId } = await createAccount(driver);

    const accounts = await rosterFor(userData).list();
    expect(accounts.map((a) => a.username)).toEqual(["ada"]);
    expect(accounts[0].id).toBe(accountId);

    const resolved = resolveActiveStore({ accounts });
    expect(resolved.custody).toBe("protected");
    expect(resolved.path).toBe(storePath(accountId));
  });

  // The whole point: the ordinary boot path must open the result, with the data
  // and the account intact. A store that converts but won't launch is worthless.
  it("leaves a store the boot path opens, with the data intact", async () => {
    const { driver } = await openStoreWithData();
    const { accountId } = await createAccount(driver);

    const accounts = await rosterFor(userData).list();
    const resolved = resolveActiveStore({ accounts });
    const reopened = await openAppDatabase({
      dbPath: join(userData, resolved.path),
      custody: resolved.custody,
      keyStore,
      requestRecoveryPhrase: never,
    });
    await runMigrations(reopened); // a no-op if user_version came across

    const people = await createPeopleRepo(reopened).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);

    // The account rows rode across with everything else.
    const account = await reopened.get<{ id: string }>(
      "SELECT id FROM account LIMIT 1",
    );
    expect(account?.id).toBe(accountId);
    await reopened.close?.();
  });

  it("writes the recovery sidecar on that first Protected open", async () => {
    const { driver } = await openStoreWithData();
    const { storePath: encryptedPath } = await createAccount(driver);

    const reopened = await openAppDatabase({
      dbPath: encryptedPath,
      custody: "protected",
      keyStore,
      requestRecoveryPhrase: never,
    });
    await reopened.close?.();
    expect(existsSync(`${encryptedPath}.recovery`)).toBe(true);
  });

  // Once the conversion has run there is no Open store left, so a repeat attempt
  // (a double-submitted form, a retry after the success screen) must refuse rather
  // than convert something a second time.
  it("refuses a second run once no Open store remains", async () => {
    const { driver } = await openStoreWithData();
    await createAccount(driver);

    await expect(createAccount(driver)).rejects.toThrow(
      /only be created from an unencrypted store/,
    );
  });

  it("requires a username", async () => {
    const { driver } = await openStoreWithData();
    await expect(
      createAccountOnThisDevice({
        keyStore,
        driver,
        roster: rosterFor(userData),
        userDataPath: userData,
        username: "  ",
        password: "correct-horse-battery",
        closeStore: async () => {},
      }),
    ).rejects.toThrow(/username is required/);
    await driver.close?.();
  });
});
