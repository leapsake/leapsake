import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATABASE_KEY } from "@leapsake/crypto";
import {
  type SqliteDriver,
  createCore,
  establishKeySession,
  joinAccountViaRelay,
  lookupAccountId,
  reconcileOnJoin,
  runAccountSync,
  runMigrations,
} from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { resolveActiveStore, storePath } from "@leapsake/store-layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeAccountOnThisDevice } from "../../src/main/db/merge-account-flow.js";
import { openAppDatabase } from "../../src/main/db/open.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";
import { type BootDevice, makeBootDevice } from "../support/boot-device.js";
import {
  type LiveAccount,
  type LiveRelay,
  accountOnAnotherDevice,
  startLiveRelay,
} from "../support/live-relay.js";

/**
 * **Merging a local-only account into a synced one, against a running relay** —
 * the half `account-merge.test.ts` cannot reach.
 *
 * That suite pins the flow's orderings and guards against a stubbed relay, and it
 * is the right place for them: they are about what happens on *this* device when
 * the relay says yes or no, and a stub says either on demand. It names two things
 * it leaves out, and both are here:
 *
 * 1. **Duplicate review after the merge.** `reconcileOnJoin` runs in the IPC
 *    handler after the roster swap, and it needs a relay that actually serves
 *    `pull`. Without it, the merge's promise — *you lose time, never work* — is
 *    only half-proven: the local rows are known to survive the copy, but not that
 *    they land beside the account's own people rather than being fused with or
 *    buried under them.
 * 2. **The failure path with a real refusal.** The flow is *built around* the
 *    relay refusing, so a hand-thrown `Error("401 unauthorized")` is exactly the
 *    input least worth trusting: it proves the flow unwinds when the injected
 *    function throws, not that a wrong password is what makes it throw.
 *
 * The device under test is the real desktop one — real encrypted stores at real
 * per-account paths, a real roster, the real boot path — and the account it merges
 * into lives on a second device with its own store, talking to the same relay.
 */

const LOCAL_PASSWORD = "the password this computer has now";
const SYNCED_USERNAME = "Henry"; // mixed case: the account stores it normalized
const SYNCED_PASSWORD = "correct horse battery staple";

const never = () => Promise.reject(new Error("unexpected unlock prompt"));

let relay: LiveRelay;
let device: BootDevice;
let account: LiveAccount;
let localId: string;
let localPath: string;

const syncedPath = () => join(device.userData, storePath(account.accountId));

beforeEach(async () => {
  relay = await startLiveRelay();
  device = makeBootDevice("merge-live");
  account = await accountOnAnotherDevice({
    relayUrl: relay.url,
    username: SYNCED_USERNAME,
    password: SYNCED_PASSWORD,
  });
  ({ accountId: localId, dbPath: localPath } =
    await device.deviceWithAccount(LOCAL_PASSWORD));
});

afterEach(async () => {
  account.cleanup();
  device.cleanup();
  await relay.close();
});

/** The live store, open the way a launch would have left it. */
const openLive = () =>
  device.bootWith({ door: "password", secret: LOCAL_PASSWORD });

/**
 * The flow wired the way the `sync:merge` IPC handler wires it — real prelogin,
 * real join, both over HTTP against the running relay.
 */
function merge(driver: SqliteDriver, password = SYNCED_PASSWORD) {
  return mergeAccountOnThisDevice({
    keyStore: device.keyStore,
    driver,
    roster: device.roster(),
    userDataPath: device.userData,
    username: SYNCED_USERNAME,
    prelogin: () =>
      lookupAccountId({ relayUrl: relay.url, username: SYNCED_USERNAME }),
    adopt: (copy, writePasswordSidecar) =>
      joinAccountViaRelay({
        keyStore: device.keyStore,
        driver: copy,
        relayUrl: relay.url,
        username: SYNCED_USERNAME,
        password,
        platform: "desktop",
        writePasswordSidecar,
      }),
    closeStore: async () => {
      await driver.close?.();
    },
  });
}

/** Re-open through the ordinary boot path, as the next launch would. */
async function bootTheDevice(): Promise<SqliteDriver> {
  const accounts = await device.roster().list();
  const resolved = resolveActiveStore({ accounts });
  return openAppDatabase({
    dbPath: join(device.userData, resolved.path),
    custody: resolved.custody,
    keyStore: device.keyStore,
    requestUnlock: never,
  });
}

describe("merging into a synced account over a running relay", () => {
  /**
   * The whole arc, and the one the merge exists for: a user who took the wrong
   * branch at the create/sign-in fork gets their data onto the account they meant
   * to use, **and** the overlap between the two sides is handed to them as a
   * review rather than resolved behind their back.
   */
  it("re-homes the device, then surfaces the overlap as duplicates without fusing anything", async () => {
    // The account already has a Jane and a Harry, pushed from its own device.
    const accountJane = await account.people.create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
    const harry = await account.people.create({
      firstName: "Harry",
      lastName: "Gower",
    });
    await account.sync();

    // This device has its own Mary (from `deviceWithAccount`) and its own Jane —
    // the same person, entered twice on two devices, with different ids.
    const live = await openLive();
    const localJane = await createPeopleRepo(live).create({
      firstName: "Jane",
      lastName: "Wainwright",
    });
    expect(localJane.id).not.toBe(accountJane.id);

    const { accountId } = await merge(live);
    expect(accountId).toBe(account.accountId);

    // Re-homed: the store lives under the synced account, the original is gone.
    expect(storeFileState(syncedPath())).toBe("encrypted");
    expect(existsSync(dirname(localPath))).toBe(false);
    expect((await device.roster().list()).map((a) => a.id)).toEqual([
      account.accountId,
    ]);

    // --- The post-swap reconcile, exactly as the IPC handler runs it. ---
    const merged = await bootTheDevice();
    await runMigrations(merged);
    const established = await establishKeySession({
      keyStore: device.keyStore,
      driver: merged,
      custody: "encrypted",
      platform: "desktop",
    });
    expect(established.state).toBe("ok");
    const session =
      established.state === "ok" ? established.keySession : undefined;
    expect(session).toBeDefined();

    const core = createCore(merged, session!);
    const { duplicateCount } = await reconcileOnJoin({
      driver: merged,
      masterKey: session!.masterKey,
      core,
    });

    // Exactly the Jane↔Jane pair. Mary and Harry are unique and are not offered.
    expect(duplicateCount).toBe(1);

    const people = await createPeopleRepo(merged).list();
    const ids = people.map((p) => p.id);
    // Nothing was fused and nothing was dropped: both Janes are still active,
    // this device's Mary survived the re-home, and the account's Harry arrived.
    expect(ids).toContain(localJane.id);
    expect(ids).toContain(accountJane.id);
    expect(ids).toContain(harry.id);
    expect(people.some((p) => p.firstName === "Mary")).toBe(true);

    const candidates = await core.duplicates.findCandidates();
    expect(
      candidates.some((c) => {
        const pair = new Set([c.a.id, c.b.id]);
        return pair.has(localJane.id) && pair.has(accountJane.id);
      }),
    ).toBe(true);
    // The sync the handler kicks off after reconciling (`scheduler.autoTrigger`)
    // — reconcile only *pulls*, so this is what carries the merged device's own
    // rows up to the account.
    await runAccountSync({
      keyStore: device.keyStore,
      driver: merged,
      masterKey: session!.masterKey,
    });
    await merged.close?.();

    // And the merged device's data really is on the account now — the other
    // device converges on the rows this one brought with it.
    await account.sync();
    const onOtherDevice = await account.people.list();
    expect(onOtherDevice.map((p) => p.id)).toContain(localJane.id);
    expect(onOtherDevice.some((p) => p.firstName === "Mary")).toBe(true);
  });

  /**
   * The invariant's real promise, driven by the refusal that actually happens.
   * The relay rejects the wrong password *before* any unwrap, and the device must
   * come out of it holding everything it had.
   */
  it("leaves the device untouched when the relay rejects the password", async () => {
    const live = await openLive();

    await expect(merge(live, "not the account's password")).rejects.toThrow(
      /401/,
    );

    // Still local-only, still encrypted, still the only account in the roster.
    expect(storeFileState(localPath)).toBe("encrypted");
    expect(storeFileState(syncedPath())).toBe("absent");
    expect((await device.roster().list()).map((a) => a.id)).toEqual([localId]);

    // And it still opens under its own password, with its rows intact. Forcing
    // the password door proves the local doors were never re-sealed.
    await device.keyStore.deleteSecret(DATABASE_KEY);
    const accounts = await device.roster().list();
    const resolved = resolveActiveStore({ accounts });
    const reopened = await openAppDatabase({
      dbPath: join(device.userData, resolved.path),
      custody: resolved.custody,
      keyStore: device.keyStore,
      requestUnlock: async () => ({
        door: "password",
        secret: LOCAL_PASSWORD,
      }),
    });
    expect(
      (await createPeopleRepo(reopened).list()).map((p) => p.firstName),
    ).toEqual(["Mary"]);
    await reopened.close?.();
  });

  /**
   * The earliest refusal there is: prelogin 404s, so the flow stops before it has
   * closed the live store or copied a byte. Worth its own case because it is the
   * one failure that happens *before* the destination path is even known.
   */
  it("leaves the device untouched when the username is unknown to the relay", async () => {
    const live = await openLive();

    await expect(
      mergeAccountOnThisDevice({
        keyStore: device.keyStore,
        driver: live,
        roster: device.roster(),
        userDataPath: device.userData,
        username: "nobody-here",
        prelogin: () =>
          lookupAccountId({ relayUrl: relay.url, username: "nobody-here" }),
        adopt: () => {
          throw new Error("the relay half must not be reached");
        },
        closeStore: async () => {
          await live.close?.();
        },
      }),
    ).rejects.toThrow(/404/);

    expect(storeFileState(localPath)).toBe("encrypted");
    expect((await device.roster().list()).map((a) => a.id)).toEqual([localId]);
    expect(existsSync(dirname(syncedPath()))).toBe(false);
  });
});
