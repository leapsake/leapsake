import { openDbKeyWithPassword } from "@leapsake/crypto";
import { createPeopleRepo, type SqliteDriver } from "@leapsake/data";
import { ensureDeviceMasterKey } from "@leapsake/key-custody";
import { startRelay } from "@leapsake/server/testing";
import { runAccountSync } from "@leapsake/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RelayError,
  joinAccount,
  recoverAccount,
  startSyncing,
} from "../src/index.js";
import { deviceWithAccount, fakeDevice } from "./fake-device.js";

const PASSWORD = "correct horse battery staple";

let relay: Awaited<ReturnType<typeof startRelay>>;
beforeEach(async () => {
  relay = await startRelay();
});
afterEach(async () => {
  await relay.close();
});

/** A device whose account is on the relay as `george`. */
async function syncedDevice() {
  const device = await deviceWithAccount("george", PASSWORD);
  await startSyncing(device.ports, { username: "george", relayUrl: relay.url });
  return device;
}

async function syncOnce(device: Awaited<ReturnType<typeof fakeDevice>>) {
  const { keyStore, driver } = device.ports;
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
  await runAccountSync({
    keyStore,
    driver,
    masterKey,
    repos: [createPeopleRepo(driver)],
  });
}

const peopleIn = async (driver: SqliteDriver) =>
  (await createPeopleRepo(driver).list()).length;

describe("joinAccount", () => {
  it("adopts the account onto this device, converting its store", async () => {
    const first = await syncedDevice();
    const second = await fakeDevice();

    const { accountId } = await joinAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      password: PASSWORD,
    });

    expect(accountId).toBe(first.accountId);
    expect(second.acts).toEqual([
      "close",
      `removeAccountStore ${accountId}`,
      `convertToEncrypted ${accountId}`,
      `writePasswordDoor ${accountId}`,
      "removePlaintextStore",
    ]);
    expect(await second.ports.roster.list()).toEqual([
      expect.objectContaining({ id: accountId, username: "george" }),
    ]);
    const store = second.disk.get(accountId)!;
    expect(openDbKeyWithPassword(store.passwordDoor!, PASSWORD)).toEqual(
      store.dbKey,
    );
  });

  it("holds the account's key, so the first device's data syncs across", async () => {
    const first = await syncedDevice();
    await syncOnce(first);
    const second = await fakeDevice();
    await joinAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      password: PASSWORD,
    });
    second.ports.custody = "encrypted";

    await syncOnce(second);

    // Each device started with its own Mary Bailey.
    expect(await peopleIn(second.ports.driver)).toBe(2);
  });

  it("refuses a wrong password, leaving the device as it was", async () => {
    await syncedDevice();
    const second = await fakeDevice();

    const failure = await joinAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      password: "not the password at all",
    }).catch((e: unknown) => e);

    expect((failure as RelayError).reason).toBe("unauthorized");
    expect(second.acts).toEqual([]);
    expect(await second.ports.roster.list()).toEqual([]);
  });

  it("names a username the relay does not know", async () => {
    const device = await fakeDevice();

    const failure = await joinAccount(device.ports, {
      relayUrl: relay.url,
      username: "clarence",
      password: PASSWORD,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RelayError);
    expect((failure as RelayError).reason).toBe("not-found");
    expect(device.acts).toEqual([]);
  });

  it("refuses a device that already holds an account", async () => {
    await syncedDevice();
    const other = await deviceWithAccount("mary", PASSWORD);

    await expect(
      joinAccount(other.ports, {
        relayUrl: relay.url,
        username: "george",
        password: PASSWORD,
      }),
    ).rejects.toThrow(/already holds an account/);
    expect(other.acts).toEqual([]);
  });
});

describe("recoverAccount", () => {
  it("adopts the account with its phrase, under a new password", async () => {
    const first = await syncedDevice();
    const second = await fakeDevice();

    const { accountId } = await recoverAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      recoveryPhrase: first.recoveryPhrase,
      newPassword: "a brand new password",
    });

    expect(accountId).toBe(first.accountId);
    const store = second.disk.get(accountId)!;
    expect(
      openDbKeyWithPassword(store.passwordDoor!, "a brand new password"),
    ).toEqual(store.dbKey);
  });

  it("leaves the account joinable with the new password", async () => {
    const first = await syncedDevice();
    await recoverAccount((await fakeDevice()).ports, {
      relayUrl: relay.url,
      username: "george",
      recoveryPhrase: first.recoveryPhrase,
      newPassword: "a brand new password",
    });
    const third = await fakeDevice();

    const { accountId } = await joinAccount(third.ports, {
      relayUrl: relay.url,
      username: "george",
      password: "a brand new password",
    });

    expect(accountId).toBe(first.accountId);
  });

  it("refuses a phrase that is not the account's, writing nothing", async () => {
    await syncedDevice();
    const stranger = await deviceWithAccount("mary", PASSWORD);
    const second = await fakeDevice();

    const failure = await recoverAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      recoveryPhrase: stranger.recoveryPhrase,
      newPassword: "a brand new password",
    }).catch((e: unknown) => e);
    expect((failure as RelayError).reason).toBe("unauthorized");
    expect(second.acts).toEqual([]);
    expect(await second.ports.roster.list()).toEqual([]);
  });

  it("refuses a short new password before calling the relay", async () => {
    const first = await syncedDevice();
    const second = await fakeDevice();

    await expect(
      recoverAccount(second.ports, {
        relayUrl: relay.url,
        username: "george",
        recoveryPhrase: first.recoveryPhrase,
        newPassword: "short",
      }),
    ).rejects.toThrow(/at least 8 characters/);
    expect(second.acts).toEqual([]);
  });
});
