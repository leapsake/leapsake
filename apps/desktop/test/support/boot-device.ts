import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryKeyStore } from "@leapsake/crypto";
import {
  type AdoptionDoor,
  type KeySession,
  type SqliteDriver,
  adoptAccountMasterKey,
  ensureDeviceMasterKey,
  resyncAfterMasterKeyRepair,
  runMigrations,
} from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import {
  type AccountRoster,
  OPEN_STORE_SLOT,
  ROSTER_PATH,
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "@leapsake/store-layout";
import { createAccountOnThisDevice } from "../../src/main/db/create-account-flow.js";
import { openAppDatabase } from "../../src/main/db/open.js";
import { jsonFileStorage } from "../../src/main/db/roster-storage.js";

/**
 * A throwaway desktop profile, driven through the *real* main-process boot path.
 *
 * Custody's defining properties are invisible above the driver — which store is
 * open, whether it is ciphertext, which keys the keychain holds — so the suites
 * that test them cannot use an in-memory driver fixture. They need a `userData`
 * directory, the roster that lives outside every store, and the same
 * `openAppDatabase` the app calls. This is that setup, shared rather than copied
 * because {@link BootDevice.bootAndRepair} models `openActiveStore`'s ordering, and
 * a second hand-rolled copy of that ordering would quietly drift from it.
 */
export interface BootDevice {
  userData: string;
  keyStore: ReturnType<typeof createInMemoryKeyStore>;
  roster(): AccountRoster;
  /**
   * The steady state an account holder is in: an account exists, the store is
   * encrypted at its per-account path, both doors sit beside it, and it holds data.
   */
  deviceWithAccount(password: string): Promise<{
    accountId: string;
    dbPath: string;
  }>;
  /** Re-open, answering whatever door the gate offers. Runs no repair. */
  bootWith(
    answer: { door: "password" | "phrase"; secret: string },
    onRequest?: (doors: { password: boolean; phrase: boolean }) => void,
  ): Promise<SqliteDriver>;
  /**
   * Re-open the way `index.ts`'s `openActiveStore` actually does, including custody
   * slice 9's master-key repair and the resync that follows an `"adopted"`.
   * `status` is `undefined` when no door was used (a normal launch).
   */
  bootAndRepair(
    answer: { door: "password" | "phrase"; secret: string },
    onRequest?: (doors: { password: boolean; phrase: boolean }) => void,
  ): Promise<{
    driver: SqliteDriver;
    keySession: KeySession | undefined;
    status: "adopted" | "unchanged" | undefined;
  }>;
  cleanup(): void;
}

export function makeBootDevice(label: string): BootDevice {
  const userData = mkdtempSync(join(tmpdir(), `leapsake-${label}-`));
  const keyStore = createInMemoryKeyStore();
  const never = () => Promise.reject(new Error("unexpected recovery prompt"));
  const roster = () =>
    createAccountRoster(jsonFileStorage(join(userData, ROSTER_PATH)));

  async function open(
    answer: { door: "password" | "phrase"; secret: string },
    onRequest:
      | ((doors: { password: boolean; phrase: boolean }) => void)
      | undefined,
    onUnlocked: (door: AdoptionDoor) => void,
  ) {
    const active = resolveActiveStore({ accounts: await roster().list() });
    const driver = await openAppDatabase({
      dbPath: join(userData, active.path),
      custody: active.custody,
      keyStore,
      requestUnlock: ({ doors }) => {
        onRequest?.(doors);
        return Promise.resolve(answer);
      },
      onUnlocked,
    });
    return { driver, custody: active.custody };
  }

  return {
    userData,
    keyStore,
    roster,

    async deviceWithAccount(password) {
      const openPath = join(userData, storePath(OPEN_STORE_SLOT));
      const driver = await openAppDatabase({
        dbPath: openPath,
        custody: "open",
        keyStore,
        requestUnlock: never,
      });
      await runMigrations(driver);
      await createPeopleRepo(driver).create({
        firstName: "Ada",
        lastName: "Lovelace",
      });
      const { accountId } = await createAccountOnThisDevice({
        keyStore,
        driver,
        roster: roster(),
        userDataPath: userData,
        username: "ada",
        password,
        closeStore: async () => {
          await driver.close?.();
        },
      });

      // The first Protected open is what writes the recovery sidecar, and it is
      // the state the app is actually in when the user acts on the account.
      const dbPath = join(userData, storePath(accountId));
      const opened = await openAppDatabase({
        dbPath,
        custody: "protected",
        keyStore,
        requestUnlock: never,
      });
      await ensureDeviceMasterKey({ keyStore, driver: opened });
      await opened.close?.();
      return { accountId, dbPath };
    },

    async bootWith(answer, onRequest) {
      const { driver } = await open(answer, onRequest, () => {});
      return driver;
    },

    async bootAndRepair(answer, onRequest) {
      let unlockedBy: AdoptionDoor | undefined;
      const { driver, custody } = await open(answer, onRequest, (door) => {
        unlockedBy = door;
      });
      await runMigrations(driver);

      let status: "adopted" | "unchanged" | undefined;
      if (unlockedBy !== undefined) {
        status = await adoptAccountMasterKey({
          keyStore,
          driver,
          door: unlockedBy,
          platform: "desktop",
        });
        if (status === "adopted") await resyncAfterMasterKeyRepair({ driver });
      }

      const keySession =
        custody === "protected"
          ? await ensureDeviceMasterKey({ keyStore, driver })
          : undefined;
      return { driver, keySession, status };
    },

    cleanup() {
      rmSync(userData, { recursive: true, force: true });
    },
  };
}
