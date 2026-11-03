import { decodeRecoveryPhrase, openDbKeyWithPassword } from "@leapsake/crypto";
import { describe, expect, it } from "vitest";
import { createAccount } from "../src/index.js";
import { fakeDevice } from "./fake-device.js";

const PASSWORD = "correct horse battery staple";

describe("createAccount", () => {
  it("converts the store, then writes its door and roster entry, then removes the original", async () => {
    const device = await fakeDevice();

    const { accountId, recoveryPhrase } = await createAccount(device.ports, {
      username: "george",
      password: PASSWORD,
    });

    expect(device.acts).toEqual([
      "close",
      `removeAccountStore ${accountId}`,
      `convertToEncrypted ${accountId}`,
      `writePasswordDoor ${accountId}`,
      "removePlaintextStore",
    ]);
    expect(await device.ports.roster.list()).toEqual([
      expect.objectContaining({ id: accountId, username: "george" }),
    ]);
    expect([...device.disk.keys()]).toEqual([accountId]);
    expect(decodeRecoveryPhrase(recoveryPhrase)).toHaveLength(32);
  });

  it("writes a password door that opens the converted store with the password", async () => {
    const device = await fakeDevice();

    const { accountId } = await createAccount(device.ports, {
      username: "george",
      password: PASSWORD,
    });

    const store = device.disk.get(accountId)!;
    expect(openDbKeyWithPassword(store.passwordDoor!, PASSWORD)).toEqual(
      store.dbKey,
    );
  });

  it("refuses a device that already holds an account, touching nothing", async () => {
    const device = await fakeDevice();
    device.ports.custody = "encrypted";

    await expect(
      createAccount(device.ports, { username: "george", password: PASSWORD }),
    ).rejects.toThrow(/already holds an account/);
    expect(device.acts).toEqual([]);
    expect(await device.ports.roster.list()).toEqual([]);
  });

  it("refuses a short password, touching nothing", async () => {
    const device = await fakeDevice();

    await expect(
      createAccount(device.ports, { username: "george", password: "short" }),
    ).rejects.toThrow(/at least 8 characters/);
    expect(device.acts).toEqual([]);
  });

  it("leaves no account behind when the conversion fails", async () => {
    const device = await fakeDevice();
    device.fail("convertToEncrypted");

    await expect(
      createAccount(device.ports, { username: "george", password: PASSWORD }),
    ).rejects.toThrow(/convertToEncrypted failed/);
    expect(await device.ports.roster.list()).toEqual([]);
    expect(device.disk.has("local")).toBe(true);
  });

  it("still returns the phrase when the original cannot be removed", async () => {
    const device = await fakeDevice();
    device.fail("removePlaintextStore");

    const { recoveryPhrase } = await createAccount(device.ports, {
      username: "george",
      password: PASSWORD,
    });

    expect(recoveryPhrase.split(" ")).toHaveLength(24);
    expect(await device.ports.roster.list()).toHaveLength(1);
  });
});
