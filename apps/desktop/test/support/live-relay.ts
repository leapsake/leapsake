import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { createInMemoryKeyStore, encodeRecoveryPhrase } from "@leapsake/crypto";
import {
  type SqliteDriver,
  enableSync,
  ensureDeviceMasterKey,
  registerAccountWithRelay,
  runAccountSync,
  runMigrations,
} from "@leapsake/core";
import { type PeopleRepo, createPeopleRepo } from "@leapsake/data";
import { createRelayServer } from "@leapsake/server/src/relay.js";
import { createRelayStore } from "@leapsake/server/src/store.js";
import { makeEncryptedTestDriver } from "./encrypted-test-driver.js";

/**
 * **The real blind relay, in-process** — the counterpart to
 * [`fake-relay.ts`](./fake-relay.ts), and the reason both exist.
 *
 * `fake-relay.ts` hand-writes the two bootstrap channels so the custody suites can
 * assert what a flow *publishes* without a socket. That is the right tool for the
 * guard cases, and the wrong one for the two questions this module answers:
 * whether the relay **accepts** what we publish, and whether its refusals reach
 * the client in the shape the client forks on. A stub answers both by
 * construction — it was written from the same reading of the protocol as the code
 * under test, so it agrees with a bug as readily as with the truth.
 *
 * Cheap enough to keep in the integration tier: an ephemeral port and an
 * in-memory relay database, no Docker, no fixtures, no network.
 */
export interface LiveRelay {
  url: string;
  /** The relay's own database, for asserting what it did (and didn't) store. */
  db: DatabaseSync;
  close(): Promise<void>;
}

export async function startLiveRelay(): Promise<LiveRelay> {
  const db = new DatabaseSync(":memory:");
  const server: Server = createRelayServer({ store: createRelayStore(db) });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port),
    );
  });
  return {
    url: `http://127.0.0.1:${port}`,
    db,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => {
          db.close();
          return err ? reject(err) : resolve();
        }),
      ),
  };
}

/**
 * **The account that already exists somewhere else** — a second device, holding a
 * synced account on the given relay, with its own encrypted store.
 *
 * The live twin of {@link existingAccount}. Where that one returns channels to
 * call, this one returns a device to *act* on: create people, sync, and watch what
 * the device under test converges to.
 */
export interface LiveAccount {
  accountId: string;
  /** Normalized, as the account stores it. */
  username: string;
  password: string;
  /** The 24 words this account was created with. */
  recoveryPhrase: string;
  masterKey: Uint8Array;
  driver: SqliteDriver;
  people: PeopleRepo;
  /** One push→pull cycle against the relay. */
  sync(): Promise<{ at: number; applied: number }>;
  cleanup(): void;
}

export async function accountOnAnotherDevice(opts: {
  relayUrl: string;
  username: string;
  password: string;
}): Promise<LiveAccount> {
  const { relayUrl, username, password } = opts;
  const keyStore = createInMemoryKeyStore();
  const { driver, cleanup } = makeEncryptedTestDriver();
  await runMigrations(driver);
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });
  const { account, recoveryKey, bootstrap } = await enableSync({
    keyStore,
    driver,
    username,
    password,
    relayUrl,
    platform: "desktop",
  });
  // Published through the same helper both clients use, so this account is
  // registered exactly as a real one is.
  await registerAccountWithRelay({ relayUrl, bootstrap });

  return {
    accountId: account.id,
    username: account.username ?? username.trim().toLowerCase(),
    password,
    recoveryPhrase: encodeRecoveryPhrase(recoveryKey),
    masterKey,
    driver,
    people: createPeopleRepo(driver),
    sync: () => runAccountSync({ keyStore, driver, masterKey }),
    cleanup,
  };
}
