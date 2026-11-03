import { createPeopleRepo } from "@leapsake/data";
import { ensureDeviceMasterKey } from "@leapsake/key-custody";
import { startRelay } from "@leapsake/server/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type SyncActivity,
  createAccountSync,
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

/** The loop a client would build for `device`, recording what it reports. */
async function syncFor(device: Awaited<ReturnType<typeof fakeDevice>>) {
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
  return { sync, activity };
}

describe("createAccountSync", () => {
  it("carries a write from one device to another", async () => {
    const first = await deviceWithAccount("george", PASSWORD);
    await startSyncing(first.ports, {
      username: "george",
      relayUrl: relay.url,
    });
    const second = await fakeDevice();
    await joinAccount(second.ports, {
      relayUrl: relay.url,
      username: "george",
      password: PASSWORD,
    });
    await second.reopen();
    const a = await syncFor(first);
    const b = await syncFor(second);

    await createPeopleRepo(first.ports.driver).create({
      firstName: "Clarence",
      lastName: "Odbody",
    });
    await a.sync.trigger();
    await b.sync.trigger();

    const names = (await createPeopleRepo(second.ports.driver).list()).map(
      (p) => p.firstName,
    );
    expect(names).toContain("Clarence");
    expect(b.activity.at(-1)).toMatchObject({ kind: "synced", changed: true });
  });

  it("skips an account that is not on a relay", async () => {
    const device = await deviceWithAccount("george", PASSWORD);
    const { sync, activity } = await syncFor(device);

    expect(await sync.trigger()).toBeUndefined();
    expect(activity).toEqual([]);
  });

  it("skips without a master key", async () => {
    const device = await fakeDevice();
    const activity: SyncActivity[] = [];
    const sync = createAccountSync({
      keyStore: device.ports.keyStore,
      driver: device.ports.driver,
      masterKey: undefined,
      repos: [],
      onActivity: (a) => activity.push(a),
    });

    expect(await sync.trigger()).toBeUndefined();
    expect(activity).toEqual([]);
  });

  it("reports an unreachable relay", async () => {
    const device = await deviceWithAccount("george", PASSWORD);
    await startSyncing(device.ports, {
      username: "george",
      relayUrl: relay.url,
    });
    const { sync, activity } = await syncFor(device);
    await relay.close();
    relay = await startRelay();

    await expect(sync.trigger()).rejects.toThrow();
    expect(activity).toEqual([
      expect.objectContaining({ kind: "failed", reason: "unreachable" }),
    ]);
  });

  it("reports a password changed on another device as unauthorized", async () => {
    const first = await deviceWithAccount("george", PASSWORD);
    await startSyncing(first.ports, {
      username: "george",
      relayUrl: relay.url,
    });
    const { sync, activity } = await syncFor(first);
    await recoverAccount((await fakeDevice()).ports, {
      relayUrl: relay.url,
      username: "george",
      recoveryPhrase: first.recoveryPhrase,
      newPassword: "a brand new password",
    });

    await expect(sync.trigger()).rejects.toThrow();
    expect(activity).toEqual([
      expect.objectContaining({ kind: "failed", reason: "unauthorized" }),
    ]);
  });
});
