import { startRelay } from "@leapsake/server/testing";
import { getSyncStatus } from "@leapsake/key-custody";
import { lookupAccount } from "@leapsake/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelayError, startSyncing } from "../src/index.js";
import { deviceWithAccount, fakeDevice } from "./fake-device.js";

const PASSWORD = "correct horse battery staple";

let relay: Awaited<ReturnType<typeof startRelay>>;
beforeEach(async () => {
  relay = await startRelay();
});
afterEach(async () => {
  await relay.close();
});

describe("startSyncing", () => {
  it("publishes the account on this device to the relay", async () => {
    const device = await deviceWithAccount("george", PASSWORD);

    const result = await startSyncing(device.ports, {
      username: "george",
      relayUrl: relay.url,
    });

    expect(result).toEqual({
      status: "bound",
      accountId: device.accountId,
      username: "george",
    });
    expect(
      await lookupAccount({ relayUrl: relay.url, username: "george" }),
    ).toBe(true);
    expect(await getSyncStatus({ driver: device.ports.driver })).toMatchObject({
      relayUrl: relay.url,
    });
  });

  it("answers a taken username as a result, leaving the account unbound", async () => {
    const first = await deviceWithAccount("george", PASSWORD);
    await startSyncing(first.ports, {
      username: "george",
      relayUrl: relay.url,
    });
    const second = await deviceWithAccount("george", PASSWORD);

    const result = await startSyncing(second.ports, {
      username: "george",
      relayUrl: relay.url,
    });

    expect(result).toEqual({ status: "username-taken", username: "george" });
    expect(
      (await getSyncStatus({ driver: second.ports.driver })).relayUrl,
    ).toBeUndefined();
  });

  it("names an unreachable relay, leaving the account unbound", async () => {
    const device = await deviceWithAccount("george", PASSWORD);
    await relay.close();
    const closed = relay.url;
    relay = await startRelay();

    const failure = await startSyncing(device.ports, {
      username: "george",
      relayUrl: closed,
    }).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(RelayError);
    expect((failure as RelayError).reason).toBe("unreachable");
    expect(
      (await getSyncStatus({ driver: device.ports.driver })).relayUrl,
    ).toBeUndefined();
  });

  it("refuses a device with no account", async () => {
    const device = await fakeDevice();

    await expect(
      startSyncing(device.ports, { username: "george", relayUrl: relay.url }),
    ).rejects.toThrow(/no account on this device/);
  });
});
