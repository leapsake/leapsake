import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATABASE_KEY, createInMemoryKeyStore } from "@leapsake/crypto";
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

/** One store slot on the fake disk: a real SQLite file, with the key and door
 *  a client would encrypt it under and write beside it. */
interface FakeStore {
  path: string;
  dbKey?: Uint8Array;
  passwordDoor?: Uint8Array;
}

/** A device whose stores are SQLite files in a temp directory, recording every
 *  file act in order; encryption itself is left to the clients' own tests. */
export async function fakeDevice() {
  const dir = mkdtempSync(join(tmpdir(), "account-flows-"));
  const slotPath = (slot: string) => join(dir, `${slot}.db`);
  const driver = nodeSqliteDriver(new DatabaseSync(slotPath("local")));
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Mary",
    lastName: "Bailey",
  });

  const disk = new Map<string, FakeStore>([
    ["local", { path: slotPath("local") }],
  ]);
  const acts: string[] = [];
  const failing = new Set<keyof StoreFiles>();

  const act = (name: keyof StoreFiles, detail = "") => {
    acts.push(detail === "" ? name : `${name} ${detail}`);
    if (failing.has(name)) throw new Error(`${name} failed`);
  };

  /** Copy slot `from` into a new slot `to`, refusing an occupied one. */
  const copySlot = (from: string, to: string, dbKey: Uint8Array) => {
    if (disk.has(to)) {
      throw new Error("a store already exists at the destination");
    }
    const source = new DatabaseSync(disk.get(from)!.path);
    source.exec(`VACUUM INTO '${slotPath(to)}'`);
    source.close();
    disk.set(to, { path: slotPath(to), dbKey });
  };

  const files: StoreFiles = {
    async close() {
      act("close");
    },
    async convertToEncrypted(accountId, dbKey) {
      act("convertToEncrypted", accountId);
      copySlot("local", accountId, dbKey);
    },
    async copyAccountStore(fromAccountId, toAccountId, dbKey) {
      act("copyAccountStore", `${fromAccountId} ${toAccountId}`);
      copySlot(fromAccountId, toAccountId, dbKey);
    },
    async openAccountStore(accountId, dbKey) {
      act("openAccountStore", accountId);
      const store = disk.get(accountId);
      if (store === undefined) throw new Error("no store in that slot");
      if (store.dbKey?.join() !== dbKey.join()) throw new Error("wrong key");
      return nodeSqliteDriver(new DatabaseSync(store.path));
    },
    async writePasswordDoor(accountId, door) {
      act("writePasswordDoor", accountId);
      const store = disk.get(accountId);
      if (store === undefined) throw new Error("no store in that slot");
      store.passwordDoor = door;
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
    /** Re-open on whichever store the roster names, as a client does after
     *  a flow; the plaintext one when it names none. */
    async reopen() {
      const [entry] = await ports.roster.list();
      if (entry === undefined) return;
      const dbKey = await ports.keyStore.getSecret(DATABASE_KEY);
      ports.driver = await files.openAccountStore(entry.id, dbKey!);
      ports.custody = "encrypted";
      acts.length = 0;
    },
  };
}

/** A {@link fakeDevice} that has created an account and re-opened on it. */
export async function deviceWithAccount(username: string, password: string) {
  const device = await fakeDevice();
  const created = await createAccount(device.ports, { username, password });
  await device.reopen();
  return { ...device, ...created };
}
