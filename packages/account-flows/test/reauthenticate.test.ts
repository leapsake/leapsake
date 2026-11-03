import { openDbKeyWithPassword } from "@leapsake/crypto";
import { createPeopleRepo } from "@leapsake/data";
import { ensureDeviceMasterKey } from "@leapsake/key-custody";
import { startRelay } from "@leapsake/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SyncActivity,
  RelayError,
  createAccountSync,
  reauthenticate,
  recoverAccount,
  startSyncing,
} from "../src/index.js";
import { deviceWithAccount, fakeDevice } from "./fake-device.js";

const OLD_PASSWORD = "building and loan";
const NEW_PASSWORD = "a brand new password";

let relay: Awaited<ReturnType<typeof startRelay>>;
beforeEach(async () => {
  relay = await startRelay();
});
afterEach(async () => {
  await relay.close();
});

/** A synced device whose password another device has since reset. */
async function deviceLeftBehind() {
  const device = await deviceWithAccount("potter", OLD_PASSWORD);
  await startSyncing(device.ports, { username: "potter", relayUrl: relay.url });
  await recoverAccount((await fakeDevice()).ports, {
    relayUrl: relay.url,
    username: "potter",
    recoveryPhrase: device.recoveryPhrase,
    newPassword: NEW_PASSWORD,
  });
  device.acts.length = 0;
  return device;
}

async function syncOnce(device: Awaited<ReturnType<typeof fakeDevice>>) {
  const { keyStore, driver } = device.ports;
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
  const activity: SyncActivity[] = [];
  const sync = createAccountSync({
    keyStore,
    driver,
    masterKey,
    repos: [createPeopleRepo(driver)],
    onActivity: (a) => activity.push(a),
  });
  await sync.trigger().catch(() => {});
  return activity;
}

describe("reauthenticate", () => {
  it("lets a device left behind by a password change sync again", async () => {
    const device = await deviceLeftBehind();
    expect(await syncOnce(device)).toEqual([
      expect.objectContaining({ kind: "failed", reason: "unauthorized" }),
    ]);

    await reauthenticate(device.ports, { password: NEW_PASSWORD });

    expect(await syncOnce(device)).toEqual([
      expect.objectContaining({ kind: "synced" }),
    ]);
  });

  it("moves this device's password door to the new password", async () => {
    const device = await deviceLeftBehind();

    await reauthenticate(device.ports, { password: NEW_PASSWORD });

    expect(device.acts).toEqual([`writePasswordDoor ${device.accountId}`]);
    const store = device.disk.get(device.accountId)!;
    expect(openDbKeyWithPassword(store.passwordDoor!, NEW_PASSWORD)).toEqual(
      store.dbKey,
    );
  });

  it("refuses the old password, leaving the door as it was", async () => {
    const device = await deviceLeftBehind();

    const failure = await reauthenticate(device.ports, {
      password: OLD_PASSWORD,
    }).catch((e: unknown) => e);

    expect((failure as RelayError).reason).toBe("unauthorized");
    expect(device.acts).toEqual([]);
    const store = device.disk.get(device.accountId)!;
    expect(openDbKeyWithPassword(store.passwordDoor!, OLD_PASSWORD)).toEqual(
      store.dbKey,
    );
  });

  it("refuses an account that is not on a relay", async () => {
    const device = await deviceWithAccount("potter", OLD_PASSWORD);

    await expect(
      reauthenticate(device.ports, { password: OLD_PASSWORD }),
    ).rejects.toThrow(/does not sync/);
  });
});
