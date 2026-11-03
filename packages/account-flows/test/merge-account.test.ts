import { RECOVERY_KEY, openDbKeyWithPassword } from "@leapsake/crypto";
import { createPeopleRepo } from "@leapsake/data";
import { ensureDeviceMasterKey, getSyncStatus } from "@leapsake/key-custody";
import { startRelay } from "@leapsake/server/testing";
import { runAccountSync } from "@leapsake/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayError, mergeIntoAccount, startSyncing } from "../src/index.js";
import { deviceWithAccount, fakeDevice } from "./fake-device.js";

const LOCAL_PASSWORD = "the local one";
const SYNCED_PASSWORD = "it's a wonderful life";

let relay: Awaited<ReturnType<typeof startRelay>>;
beforeEach(async () => {
  relay = await startRelay();
});
afterEach(async () => {
  await relay.close();
});

type Device = Awaited<ReturnType<typeof fakeDevice>>;

async function syncOnce(device: Device) {
  const { keyStore, driver } = device.ports;
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
  await runAccountSync({
    keyStore,
    driver,
    masterKey,
    repos: [createPeopleRepo(driver)],
  });
}

/** `potter` on the relay, holding Clarence Odbody. */
async function syncedAccount() {
  const device = await deviceWithAccount("potter", SYNCED_PASSWORD);
  await startSyncing(device.ports, { username: "potter", relayUrl: relay.url });
  await createPeopleRepo(device.ports.driver).create({
    firstName: "Clarence",
    lastName: "Odbody",
  });
  await syncOnce(device);
  return device;
}

const names = async (device: Device) =>
  (await createPeopleRepo(device.ports.driver).list())
    .map((p) => p.firstName)
    .sort();

describe("mergeIntoAccount", () => {
  it("re-homes the local store under the synced account, keeping its rows", async () => {
    const synced = await syncedAccount();
    const local = await deviceWithAccount("george", LOCAL_PASSWORD);

    const { accountId } = await mergeIntoAccount(local.ports, {
      relayUrl: relay.url,
      username: "potter",
      password: SYNCED_PASSWORD,
    });

    expect(accountId).toBe(synced.accountId);
    expect(local.acts).toEqual([
      "close",
      `removeAccountStore ${accountId}`,
      `copyAccountStore ${local.accountId} ${accountId}`,
      `openAccountStore ${accountId}`,
      `writePasswordDoor ${accountId}`,
      `removeAccountStore ${local.accountId}`,
    ]);
    expect(await local.ports.roster.list()).toEqual([
      expect.objectContaining({ id: accountId, username: "potter" }),
    ]);
    expect([...local.disk.keys()]).toEqual([accountId]);
    const store = local.disk.get(accountId)!;
    expect(openDbKeyWithPassword(store.passwordDoor!, SYNCED_PASSWORD)).toEqual(
      store.dbKey,
    );
  });

  it("syncs both devices' people once re-opened", async () => {
    await syncedAccount();
    const local = await deviceWithAccount("george", LOCAL_PASSWORD);
    await mergeIntoAccount(local.ports, {
      relayUrl: relay.url,
      username: "potter",
      password: SYNCED_PASSWORD,
    });
    await local.reopen();

    await syncOnce(local);

    expect(await getSyncStatus({ driver: local.ports.driver })).toMatchObject({
      username: "potter",
      relayUrl: relay.url,
    });
    // Each device started with its own Mary Bailey.
    expect(await names(local)).toEqual(["Clarence", "Mary", "Mary"]);
  });

  it("leaves the local account as it was when the password is wrong", async () => {
    await syncedAccount();
    const local = await deviceWithAccount("george", LOCAL_PASSWORD);
    const recoveryBefore = await local.ports.keyStore.getSecret(RECOVERY_KEY);

    const failure = await mergeIntoAccount(local.ports, {
      relayUrl: relay.url,
      username: "potter",
      password: "not the password",
    }).catch((e: unknown) => e);

    expect((failure as RelayError).reason).toBe("unauthorized");
    expect(await local.ports.roster.list()).toEqual([
      expect.objectContaining({ id: local.accountId, username: "george" }),
    ]);
    expect([...local.disk.keys()]).toEqual([local.accountId]);
    expect(await local.ports.keyStore.getSecret(RECOVERY_KEY)).toEqual(
      recoveryBefore,
    );
    await local.reopen();
    expect(
      (await getSyncStatus({ driver: local.ports.driver })).accountId,
    ).toBe(local.accountId);
  });

  it("puts the keychain back when the merge fails after logging in", async () => {
    await syncedAccount();
    const local = await deviceWithAccount("george", LOCAL_PASSWORD);
    const recoveryBefore = await local.ports.keyStore.getSecret(RECOVERY_KEY);
    local.fail("writePasswordDoor");

    await expect(
      mergeIntoAccount(local.ports, {
        relayUrl: relay.url,
        username: "potter",
        password: SYNCED_PASSWORD,
      }),
    ).rejects.toThrow(/writePasswordDoor failed/);

    expect(await local.ports.keyStore.getSecret(RECOVERY_KEY)).toEqual(
      recoveryBefore,
    );
    expect([...local.disk.keys()]).toEqual([local.accountId]);
    expect((await local.ports.roster.list()).map((a) => a.id)).toEqual([
      local.accountId,
    ]);
  });

  it("names a username the relay does not know, before closing the store", async () => {
    const local = await deviceWithAccount("george", LOCAL_PASSWORD);

    const failure = await mergeIntoAccount(local.ports, {
      relayUrl: relay.url,
      username: "clarence",
      password: SYNCED_PASSWORD,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RelayError);
    expect((failure as RelayError).reason).toBe("not-found");
    expect(local.acts).toEqual([]);
  });

  it("refuses an account that already syncs", async () => {
    const synced = await syncedAccount();

    await expect(
      mergeIntoAccount(synced.ports, {
        relayUrl: relay.url,
        username: "potter",
        password: SYNCED_PASSWORD,
      }),
    ).rejects.toThrow(/already syncs/);
  });

  it("refuses a device with no account", async () => {
    const device = await fakeDevice();

    await expect(
      mergeIntoAccount(device.ports, {
        relayUrl: relay.url,
        username: "potter",
        password: SYNCED_PASSWORD,
      }),
    ).rejects.toThrow(/no account to merge/);
  });
});
