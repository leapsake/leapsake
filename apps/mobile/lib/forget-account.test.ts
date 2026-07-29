import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  generateKey,
} from "@leapsake/crypto";
import {
  type RosterStorage,
  createAccountRoster,
  storePath,
} from "@leapsake/store-layout";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetAccountOnThisDevice } from "./forget-account";

/**
 * **Forget account**, mobile (`model.md` §7.3). The storage verbs are injected, so
 * what these cover is the part that is actually easy to get wrong and identical on
 * both clients: *what is removed, in what order, and what deliberately survives.*
 * The expo-sqlite verbs themselves are proved on device by the custody self-test.
 */
const ACCOUNT = "ba05c5ec-559e-4670-96f2-88828301d6f2";
const OTHER = "11111111-2222-3333-4444-555555555555";

let keyStore: ReturnType<typeof createInMemoryKeyStore>;
let stored: string | undefined;
let deletedStores: string[];
let doorsDeleted: number;
/** Every effect, in the order it happened — the assertion these tests turn on. */
let order: string[];

const storage: RosterStorage = {
  read: async () => stored,
  write: async (text) => {
    stored = text;
    order.push("roster");
  },
};

const roster = () => createAccountRoster(storage);

const forget = (accountId: string) =>
  forgetAccountOnThisDevice({
    keyStore,
    roster: roster(),
    accountId,
    storeName: storePath(accountId),
    deleteStore: async (name) => {
      deletedStores.push(name);
      order.push("store");
    },
    deleteDoors: async () => {
      doorsDeleted += 1;
      order.push("doors");
    },
  });

beforeEach(async () => {
  keyStore = createInMemoryKeyStore();
  await keyStore.setSecret(DATABASE_KEY, generateKey());
  await keyStore.setSecret(RECOVERY_KEY, generateKey());
  await keyStore.setSecret("device-id", new TextEncoder().encode("device-1"));
  await keyStore.setSecret("enclave", generateKey());
  stored = undefined;
  deletedStores = [];
  doorsDeleted = 0;
  order = [];
  await roster().add({
    id: ACCOUNT,
    username: "ada",
    createdAt: new Date().toISOString(),
  });
  order = []; // ignore the setup write
});

describe("forgetAccountOnThisDevice (mobile)", () => {
  it("removes the roster entry, the store, and both doors", async () => {
    await forget(ACCOUNT);

    expect(await roster().list()).toEqual([]);
    expect(deletedStores).toEqual([storePath(ACCOUNT)]);
    expect(doorsDeleted).toBe(1);
  });

  // The roster goes first so a crash lands the device Open rather than Protected
  // and pointed at a store that is gone; the doors go after the store so a door
  // can never outlive what it opened.
  it("drops the roster entry before touching any file", async () => {
    await forget(ACCOUNT);

    expect(order).toEqual(["roster", "store", "doors"]);
  });

  it("clears the keys that opened it", async () => {
    await forget(ACCOUNT);

    expect(await keyStore.getSecret(DATABASE_KEY)).toBeUndefined();
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
  });

  // Clearing these would make `ensureDeviceMasterKey` mint a *new* master key on
  // the next launch, orphaning every content key wrapped under the old one.
  it("keeps this device's identity", async () => {
    await forget(ACCOUNT);

    expect(await keyStore.getSecret("device-id")).toBeDefined();
    expect(await keyStore.getSecret("enclave")).toBeDefined();
  });

  it("refuses an account this device does not hold", async () => {
    await expect(forget(OTHER)).rejects.toThrow(/not on this device/);

    // It refused before touching anything.
    expect((await roster().list()).length).toBe(1);
    expect(deletedStores).toEqual([]);
    expect(doorsDeleted).toBe(0);
    expect(await keyStore.getSecret(DATABASE_KEY)).toBeDefined();
  });

  it("leaves another account's roster entry alone", async () => {
    await roster().add({
      id: OTHER,
      username: "grace",
      createdAt: new Date().toISOString(),
    });

    await forget(ACCOUNT);

    expect((await roster().list()).map((a) => a.username)).toEqual(["grace"]);
    expect(deletedStores).toEqual([storePath(ACCOUNT)]);
  });
});
