import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type StoreFiles, createAccount } from "@leapsake/account-flows";
import type { KeyStore } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/core";
import {
  type AccountRoster,
  UNAUTHENTICATED_STORE_SLOT,
  storePath,
} from "@leapsake/store-layout";
import { convertStoreToEncrypted, destroyStoreFiles } from "./convert-store.js";
import { passwordSidecarPath, writeSidecar } from "./sidecars.js";
import { storeFileState } from "./sqlite-header.js";

/** Desktop's {@link StoreFiles}: each store a file under `userDataPath`, its
 *  doors sidecar files beside it. */
export function desktopStoreFiles(opts: {
  userDataPath: string;
  closeStore: () => Promise<void>;
}): StoreFiles {
  const { userDataPath } = opts;
  const plaintextPath = join(
    userDataPath,
    storePath(UNAUTHENTICATED_STORE_SLOT),
  );
  const accountPath = (accountId: string) =>
    join(userDataPath, storePath(accountId));

  return {
    close: opts.closeStore,
    async convertToEncrypted(accountId, dbKey) {
      convertStoreToEncrypted({
        fromPath: plaintextPath,
        toPath: accountPath(accountId),
        key: dbKey,
      });
    },
    async writePasswordDoor(accountId, door) {
      writeSidecar(passwordSidecarPath(accountPath(accountId)), door);
    },
    async removeAccountStore(accountId) {
      rmSync(dirname(accountPath(accountId)), { recursive: true, force: true });
    },
    async removePlaintextStore() {
      destroyStoreFiles(plaintextPath);
      rmSync(dirname(plaintextPath), { recursive: true, force: true });
    },
  };
}

/** Create an account and turn encryption on, over {@link desktopStoreFiles}. */
export async function createAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  /** The open store, which must be the plaintext one. */
  driver: SqliteDriver;
  roster: AccountRoster;
  userDataPath: string;
  username: string;
  password: string;
  /** Close the store's handle; the conversion needs the file quiescent. */
  closeStore: () => Promise<void>;
}): Promise<{ accountId: string; recoveryPhrase: string; storePath: string }> {
  const { keyStore, driver, roster, userDataPath, username, password } = opts;
  const plaintextPath = join(
    userDataPath,
    storePath(UNAUTHENTICATED_STORE_SLOT),
  );
  const { accountId, recoveryPhrase } = await createAccount(
    {
      keyStore,
      driver,
      custody:
        storeFileState(plaintextPath) === "plaintext"
          ? "plaintext"
          : "encrypted",
      roster,
      files: desktopStoreFiles(opts),
      platform: "desktop",
    },
    { username, password },
  );
  return {
    accountId,
    recoveryPhrase,
    storePath: join(userDataPath, storePath(accountId)),
  };
}
