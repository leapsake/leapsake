import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATABASE_KEY, RECOVERY_KEY, unwrapKey } from "@leapsake/crypto";
import {
  type KeySession,
  type PasswordDoorWriter,
  type SqliteDriver,
  joinAccount,
  runMigrations,
} from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { resolveActiveStore, storePath } from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeAccountOnThisDevice } from "../../src/main/db/merge-account-flow.js";
import {
  type UnlockAnswer,
  type UnlockRequest,
  openAppDatabase,
} from "../../src/main/db/open.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";
import { type BootDevice, makeBootDevice } from "../support/boot-device.js";
import {
  type SyncedAccount,
  existingAccount,
  sealLikeCore,
} from "../support/fake-relay.js";

/**
 * **Merging a local-only account into a synced one** — the desktop acceptance
 * (`encryption/model.md` §7.2.2), and the third member of the family beside
 * `create-account.test.ts` and `account-adopt.test.ts`.
 *
 * The state under test is the one `makeBootDevice().deviceWithAccount()` already
 * builds: an **Authenticated local-only** device — its own account, its own
 * encrypted store at its own per-account path, both doors sealed, real data
 * inside. That device signs in to an account that exists elsewhere, and must come
 * out the other side re-homed, intact, and opening under the *synced* account's
 * password.
 *
 * Two properties get the most weight here because they are the ones a wrong
 * ordering breaks silently: **a failed merge must leave the device exactly as it
 * was** (the relay is what fails, and the flow copies before it mutates), and the
 * **recovery key must be restored** when a merge fails after the relay handed it
 * over — the keychain is device-global, so the copy cannot contain it.
 *
 * **Not covered here: duplicate review.** `reconcileOnJoin` runs in the IPC
 * handler after the swap, not inside this flow, and exercising it needs a relay
 * that serves `pull` (`account-adopt.test.ts` does not test it either). What the
 * "keeps its rows" and "adopts the synced account" cases pin are exactly its two
 * preconditions: the local people survived the copy, and the account is now
 * relay-bound. The review path itself — and the failure path driven by a *real*
 * refusal rather than an injected throw — lives in
 * [`account-merge-live.test.ts`](./account-merge-live.test.ts), against a relay
 * running in-process.
 */

const LOCAL_PASSWORD = "the password this computer has now";
const SYNCED_USERNAME = "Grace"; // mixed case: the account stores it normalized
const SYNCED_PASSWORD = "correct horse battery staple";
const RELAY_URL = "https://relay.example";

const never = () => Promise.reject(new Error("unexpected unlock prompt"));

let device: BootDevice;
let account: SyncedAccount;
let localId: string;
let localPath: string;

/** Where the store is expected to land. */
const syncedPath = () =>
  join(device.userData, storePath(account.bootstrap.accountId));

beforeEach(async () => {
  device = makeBootDevice("merge");
  account = await existingAccount({
    username: SYNCED_USERNAME,
    password: SYNCED_PASSWORD,
    relayUrl: RELAY_URL,
  });
  ({ accountId: localId, dbPath: localPath } =
    await device.deviceWithAccount(LOCAL_PASSWORD));
});

afterEach(() => {
  account.cleanup();
  device.cleanup();
});

/** The live store, open the way a launch would have left it. */
const openLive = () =>
  device.bootWith({ door: "password", secret: LOCAL_PASSWORD });

/**
 * The flow, wired exactly as the IPC handler wires it: prelogin over the relay,
 * and a join that runs against the driver the flow hands it — the copy, never
 * this one.
 */
function merge(
  driver: SqliteDriver,
  adopt?: (
    copy: SqliteDriver,
    write: PasswordDoorWriter,
  ) => Promise<KeySession>,
) {
  return mergeAccountOnThisDevice({
    keyStore: device.keyStore,
    driver,
    roster: device.roster(),
    userDataPath: device.userData,
    username: SYNCED_USERNAME,
    prelogin: async () => account.relay().lookup(SYNCED_USERNAME),
    adopt:
      adopt ??
      (async (copy, write) => {
        const session = await joinAccount({
          keyStore: device.keyStore,
          driver: copy,
          transport: account.relay(),
          relayUrl: RELAY_URL,
          username: SYNCED_USERNAME,
          password: SYNCED_PASSWORD,
          platform: "desktop",
        });
        await sealLikeCore({
          keyStore: device.keyStore,
          driver: copy,
          password: SYNCED_PASSWORD,
          write,
        });
        return session;
      }),
    closeStore: async () => {
      await driver.close?.();
    },
  });
}

/** Re-open through the ordinary boot path, as the next launch would. */
async function bootTheDevice(
  requestUnlock: (request: UnlockRequest) => Promise<UnlockAnswer> = never,
): Promise<SqliteDriver> {
  const accounts = await device.roster().list();
  const resolved = resolveActiveStore({ accounts });
  return openAppDatabase({
    dbPath: join(device.userData, resolved.path),
    custody: resolved.custody,
    keyStore: device.keyStore,
    requestUnlock,
  });
}

describe("merging a local-only account into a synced one", () => {
  it("re-homes the store under the synced account and keeps the rows", async () => {
    const driver = await openLive();

    const { accountId } = await merge(driver);
    expect(accountId).toBe(account.bootstrap.accountId);

    // The file moved; the original and its doors are gone.
    expect(storeFileState(syncedPath())).toBe("encrypted");
    expect(existsSync(localPath)).toBe(false);
    expect(existsSync(dirname(localPath))).toBe(false);

    // One account, and it is the synced one — the roster is what the boot path
    // reads, so this is what makes the merge real.
    const accounts = await device.roster().list();
    expect(accounts.map((a) => a.id)).toEqual([account.bootstrap.accountId]);
    expect(resolveActiveStore({ accounts }).path).toBe(
      storePath(account.bootstrap.accountId),
    );

    const reopened = await bootTheDevice();
    await runMigrations(reopened); // a no-op if user_version came across
    const people = await createPeopleRepo(reopened).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);
    await reopened.close?.();
  });

  it("retires the local account and adopts the synced one", async () => {
    await merge(await openLive());

    const reopened = await bootTheDevice();
    const row = await reopened.get<{
      id: string;
      username: string;
      relay_url: string;
    }>("SELECT id, username, relay_url FROM account LIMIT 1");
    expect(row?.id).toBe(account.bootstrap.accountId);
    expect(row?.id).not.toBe(localId);
    expect(row?.username).toBe("grace");
    // Relay-bound is the second of `reconcileOnJoin`'s two preconditions.
    expect(row?.relay_url).toBe(RELAY_URL);
    await reopened.close?.();
  });

  // The headline user-visible property, and the reason this increment needs copy
  // rather than only a migration. Both directions matter: the new password must
  // work *and* the old one must not.
  it("stops opening under the local password, and opens under the synced one", async () => {
    await merge(await openLive());
    await (await bootTheDevice()).close?.(); // seal the recovery door

    // Force the password door to be used at all.
    await device.keyStore.deleteSecret(DATABASE_KEY);

    const asked: Array<string | undefined> = [];
    const unlocked = await bootTheDevice(async (request) => {
      asked.push(request.error);
      return asked.length === 1
        ? { door: "password", secret: LOCAL_PASSWORD }
        : { door: "password", secret: SYNCED_PASSWORD };
    });

    // The first answer was the pre-merge password, and the gate rejected it.
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBeUndefined();
    expect(asked[1]).toBeTruthy();

    const people = await createPeopleRepo(unlocked).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);
    await unlocked.close?.();
  });

  // The merge swaps this device's master key for the account's. The adopted key
  // must end up bound exactly once — a leftover wrap for the retired local
  // account's key would be an unopenable row at best, a wrong unwrap at worst.
  it("binds the adopted master key exactly once", async () => {
    await merge(await openLive());

    const { driver, established } = await device.bootAndRepair({
      door: "password",
      secret: SYNCED_PASSWORD,
    });
    expect(established.state).toBe("ok");

    const enclave = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave' " +
        "AND deleted_at IS NULL",
    );
    expect(enclave[0]?.n).toBe(1);

    // It is the *account's* key, not a survivor of the local one.
    const masterKey =
      established.state === "ok"
        ? established.keySession?.masterKey
        : undefined;
    expect(masterKey).toBeDefined();
    expect(unwrapKey(account.bootstrap.wrappedRecoveryKey, masterKey!)).toEqual(
      account.recoveryKey,
    );
    await driver.close?.();
  });

  // The invariant's real promise. A wrong password or an unreachable relay is the
  // common case, and it must cost the user nothing but the attempt.
  it("leaves the device untouched when the relay refuses", async () => {
    const driver = await openLive();

    await expect(
      merge(driver, async () => {
        throw new Error("401 unauthorized");
      }),
    ).rejects.toThrow(/401/);

    expect(storeFileState(localPath)).toBe("encrypted");
    expect(storeFileState(syncedPath())).toBe("absent");
    expect((await device.roster().list()).map((a) => a.id)).toEqual([localId]);

    // Still the same device it was: same password, same rows.
    await device.keyStore.deleteSecret(DATABASE_KEY);
    const reopened = await bootTheDevice(async () => ({
      door: "password",
      secret: LOCAL_PASSWORD,
    }));
    const people = await createPeopleRepo(reopened).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);
    await reopened.close?.();
  });

  // The one thing copying cannot protect: `joinAccount` writes the account's
  // recovery key into the *device* keychain. Without the flow's restore, the
  // caller's re-open re-seals the abandoned local store's `.recovery` under a
  // phrase that store's master-key wrap does not match — killing its phrase door
  // on a merge that failed.
  it("restores the recovery key when the merge fails after the relay half", async () => {
    const before = await device.keyStore.getSecret(RECOVERY_KEY);
    expect(before).toBeDefined();

    const driver = await openLive();
    await expect(
      merge(driver, async (copy, write) => {
        await joinAccount({
          keyStore: device.keyStore,
          driver: copy,
          transport: account.relay(),
          relayUrl: RELAY_URL,
          username: SYNCED_USERNAME,
          password: SYNCED_PASSWORD,
          platform: "desktop",
        });
        await sealLikeCore({
          keyStore: device.keyStore,
          driver: copy,
          password: SYNCED_PASSWORD,
          write,
        });
        throw new Error("the local half fell over");
      }),
    ).rejects.toThrow(/fell over/);

    expect(await device.keyStore.getSecret(RECOVERY_KEY)).toEqual(before);
    expect((await device.roster().list()).map((a) => a.id)).toEqual([localId]);
    expect(storeFileState(syncedPath())).toBe("absent");
  });

  // A crash between the copy and the roster swap leaves a destination nobody
  // claims. The retry must clear it rather than trip the overwrite guard.
  it("clears a stranded destination no roster entry claims", async () => {
    mkdirSync(dirname(syncedPath()), { recursive: true });
    writeFileSync(syncedPath(), "leftovers from a crashed attempt");
    expect(storeFileState(syncedPath())).not.toBe("absent");

    await merge(await openLive());

    expect(storeFileState(syncedPath())).toBe("encrypted");
    const reopened = await bootTheDevice();
    const people = await createPeopleRepo(reopened).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);
    await reopened.close?.();
  });

  // The converter's overwrite guard sees a file, never a claim. Here the user
  // picks the account, so a destination that is somebody's live store is a
  // reachable input rather than an impossible one.
  it("refuses a destination a roster entry already claims", async () => {
    await device.roster().add({
      id: account.bootstrap.accountId,
      username: "grace",
      createdAt: new Date().toISOString(),
    });
    const driver = await openLive();

    await expect(merge(driver)).rejects.toThrow(/already holds that account/);

    expect(storeFileState(localPath)).toBe("encrypted");
    expect((await device.roster().list()).map((a) => a.id)).toContain(localId);
    await driver.close?.();
  });

  it("refuses on a device that has no account to merge", async () => {
    const fresh = makeBootDevice("merge-unauth");
    try {
      const driver = await openAppDatabase({
        dbPath: join(fresh.userData, storePath("local")),
        custody: "plaintext",
        keyStore: fresh.keyStore,
        requestUnlock: never,
      });
      await runMigrations(driver);

      await expect(
        mergeAccountOnThisDevice({
          keyStore: fresh.keyStore,
          driver,
          roster: fresh.roster(),
          userDataPath: fresh.userData,
          username: SYNCED_USERNAME,
          prelogin: async () => account.relay().lookup(SYNCED_USERNAME),
          adopt: async () => {
            throw new Error("should not reach the relay");
          },
          closeStore: async () => {
            await driver.close?.();
          },
        }),
      ).rejects.toThrow(/no account to merge/);
      await driver.close?.();
    } finally {
      fresh.cleanup();
    }
  });

  // Re-homing a store that is already bound to a relay would orphan that
  // account's binding and every expectation its other devices hold.
  it("refuses a source that is already signed in", async () => {
    const driver = await openLive();
    await driver.run("UPDATE account SET relay_url = ?", [RELAY_URL]);

    await expect(merge(driver)).rejects.toThrow(/already signed in/);

    expect(storeFileState(localPath)).toBe("encrypted");
    expect(storeFileState(syncedPath())).toBe("absent");
    await driver.close?.();
  });

  // Layer 3 (`packages/data/src/content-cipher.ts`) wraps per-entity content keys
  // under the master key, and this merge *swaps* the master key without
  // re-wrapping anything. That is only safe while nothing writes those rows —
  // migration 27 retired the last writer. When this fails, one exists again, and
  // the flow needs a re-wrap loop before it can be called correct.
  it("has no live content keys, which is why swapping the master key is safe", async () => {
    const driver = await openLive();
    const rows = await driver.all<{ id: string }>(
      "SELECT id FROM content_key WHERE deleted_at IS NULL",
    );
    expect(rows).toEqual([]);
    await driver.close?.();
  });
});
