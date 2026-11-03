import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore } from "@leapsake/crypto";
import { createPeopleRepo, runMigrations } from "@leapsake/data";
import { nodeSqliteDriver } from "@leapsake/data/node-sqlite";
import {
  type RosterStorage,
  createAccountRoster,
} from "@leapsake/store-layout";
import {
  type AccountFlowPorts,
  type StoreFiles,
  createAccount,
} from "../src/index.js";

/** One store slot on the fake disk; `encrypted` holds its key. */
interface FakeStore {
  dbKey?: Uint8Array;
  passwordDoor?: Uint8Array;
}

/** A device whose store files live in memory, recording every file act in
 *  order; the store itself is real SQLite. */
export async function fakeDevice() {
  const driver = nodeSqliteDriver(new DatabaseSync(":memory:"));
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Mary",
    lastName: "Bailey",
  });

  const disk = new Map<string, FakeStore>([["local", {}]]);
  const acts: string[] = [];
  const failing = new Set<keyof StoreFiles>();

  const act = (name: keyof StoreFiles, detail = "") => {
    acts.push(detail === "" ? name : `${name} ${detail}`);
    if (failing.has(name)) throw new Error(`${name} failed`);
  };

  const files: StoreFiles = {
    async close() {
      act("close");
    },
    async convertToEncrypted(accountId, dbKey) {
      act("convertToEncrypted", accountId);
      if (disk.has(accountId)) {
        throw new Error("a store already exists at the destination");
      }
      disk.set(accountId, { dbKey });
    },
    async writePasswordDoor(accountId, door) {
      act("writePasswordDoor", accountId);
      const store = disk.get(accountId) ?? {};
      disk.set(accountId, { ...store, passwordDoor: door });
    },
    async removeAccountStore(accountId) {
      act("removeAccountStore", accountId);
      disk.delete(accountId);
    },
    async removePlaintextStore() {
      act("removePlaintextStore");
      disk.delete("local");
    },
  };

  let rosterText: string | undefined;
  const rosterStorage: RosterStorage = {
    read: async () => rosterText,
    write: async (text) => {
      rosterText = text;
    },
  };

  const ports: AccountFlowPorts = {
    keyStore: createInMemoryKeyStore(),
    driver,
    custody: "plaintext",
    roster: createAccountRoster(rosterStorage),
    files,
    platform: "test",
  };

  return {
    ports,
    disk,
    /** Every file act so far, as `name accountId`. */
    acts,
    /** Make a file act throw from now on. */
    fail: (name: keyof StoreFiles) => failing.add(name),
  };
}

/** A {@link fakeDevice} that has created an account and re-opened on it. */
export async function deviceWithAccount(username: string, password: string) {
  const device = await fakeDevice();
  const created = await createAccount(device.ports, { username, password });
  device.ports.custody = "encrypted";
  device.acts.length = 0;
  return { ...device, ...created };
}
