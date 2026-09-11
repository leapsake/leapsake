import { existsSync } from "node:fs";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  encodeRecoveryPhrase,
  equalBytes,
} from "@leapsake/crypto";
import { ensureDeviceMasterKey, lockThisDevice } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type BootDevice, makeBootDevice } from "../support/boot-device.js";
import { storeFileState } from "../../src/main/db/sqlite-header.js";

/**
 * **Sign out** (`model.md` §7.3), slice 7's first half: the deliberate route into
 * the Locked state.
 *
 * The behavior under test is a round trip, not a deletion — sign out is only
 * correct if the password brings *everything* back. So each case here pairs a
 * "the door really closed" assertion with the "and it really re-opens" one, and
 * the last two cover the ways a naive implementation gets it wrong: leaving a key
 * that makes the lock theater, or clearing one that makes the unlock lossy.
 */
const PASSWORD = "correct-horse-battery";

let device: BootDevice;
let keyStore: BootDevice["keyStore"];

beforeEach(() => {
  device = makeBootDevice("signout");
  keyStore = device.keyStore;
});
afterEach(() => {
  device.cleanup();
});

const deviceWithAccount = () => device.deviceWithAccount(PASSWORD);
const bootWith: BootDevice["bootWith"] = (answer, onRequest) =>
  device.bootWith(answer, onRequest);

describe("sign out", () => {
  it("closes the store behind the password, leaving the data encrypted in place", async () => {
    const { dbPath } = await deviceWithAccount();

    await lockThisDevice({ keyStore });

    // The promise: nobody can see the data on this device any more — but the
    // bytes are still here, which is the half that distinguishes it from Forget.
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    expect(storeFileState(dbPath)).toBe("encrypted");
    expect(existsSync(`${dbPath}.password`)).toBe(true);
    expect(existsSync(`${dbPath}.recovery`)).toBe(true);
  });

  it("the password re-opens it, with the data intact", async () => {
    await deviceWithAccount();
    await lockThisDevice({ keyStore });

    let offered: { password: boolean; phrase: boolean } | undefined;
    const reopened = await bootWith(
      { door: "password", secret: PASSWORD },
      (doors) => {
        offered = doors;
      },
    );

    // The gate was genuinely raised, and offered both doors with the password
    // primary — the point of clearing the key rather than closing the handle.
    expect(offered).toEqual({ password: true, phrase: true });
    expect((await createPeopleRepo(reopened).list())[0]?.firstName).toBe(
      "Mary",
    );
    await reopened.close?.();
  });

  // The words the user wrote down at account creation are unaffected by signing
  // out: they open `<db>.recovery` directly, with nothing read from the keychain.
  it("the recovery phrase still works as the forgot-password door", async () => {
    await deviceWithAccount();
    const recoveryKey = await keyStore.getSecret(RECOVERY_KEY);
    if (recoveryKey === undefined) throw new Error("expected a recovery key");
    const phrase = encodeRecoveryPhrase(recoveryKey);

    await lockThisDevice({ keyStore });

    const reopened = await bootWith({ door: "phrase", secret: phrase });
    expect((await createPeopleRepo(reopened).list())[0]?.firstName).toBe(
      "Mary",
    );
    await reopened.close?.();
  });

  // The failure a naive sign out ships: clearing the db-key alone. `<db>.recovery`
  // holds seal(db-key, recoveryKey) in plain view, so a recovery key left in the
  // keychain reconstructs the db-key with no user secret involved — the file would
  // look locked while anything holding the keychain could still open it.
  it("clears the recovery key too, so the sidecar is not a way back in", async () => {
    await deviceWithAccount();
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeDefined();

    await lockThisDevice({ keyStore });

    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
  });

  // The opposite failure: clearing too much. `ensureDeviceMasterKey` keys its
  // lookup on the device id, so a cleared id finds no wrap row, mints a *new*
  // master key, and orphans every content key wrapped under the old one. Signing
  // out and back in has to be a no-op above the at-rest layer.
  it("keeps the device identity, so the master key survives the round trip", async () => {
    await deviceWithAccount();
    const before = await bootWith({ door: "password", secret: PASSWORD });
    const sessionBefore = await ensureDeviceMasterKey({
      keyStore,
      driver: before,
    });
    await before.close?.();

    await lockThisDevice({ keyStore });

    const after = await bootWith({ door: "password", secret: PASSWORD });
    const sessionAfter = await ensureDeviceMasterKey({
      keyStore,
      driver: after,
    });

    expect(sessionAfter.deviceId).toBe(sessionBefore.deviceId);
    expect(equalBytes(sessionAfter.masterKey, sessionBefore.masterKey)).toBe(
      true,
    );
    // And no second wrap row was minted alongside the first.
    const wraps = await after.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE principal_kind = 'enclave'",
    );
    expect(wraps[0]?.n).toBe(1);
    await after.close?.();
  });

  it("is idempotent — signing out an already-locked device is harmless", async () => {
    await deviceWithAccount();
    await lockThisDevice({ keyStore });
    await expect(lockThisDevice({ keyStore })).resolves.toBeUndefined();

    const reopened = await bootWith({ door: "password", secret: PASSWORD });
    expect((await createPeopleRepo(reopened).list()).length).toBe(1);
    await reopened.close?.();
  });
});
