import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyStore } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/core";
import { createLocalAccount } from "@leapsake/core";
import {
  type AccountRoster,
  UNAUTHENTICATED_STORE_SLOT,
  storePath,
} from "@leapsake/store-layout";
import {
  clearUnclaimedDestination,
  convertStoreToEncrypted,
  destroyStoreFiles,
} from "./convert-store.js";
import { passwordSidecarPath, writeSidecar } from "./sidecars.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * Create an account and turn encryption on: mint the keys, convert the store,
 * name it in the roster, then destroy the plaintext original.
 */
export async function createAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  /** The open **plaintext** store; account rows are written into it first. */
  driver: SqliteDriver;
  roster: AccountRoster;
  userDataPath: string;
  username: string;
  password: string;
  /** Close the store's handle; the conversion needs the file quiescent. */
  closeStore: () => Promise<void>;
}): Promise<{ accountId: string; recoveryPhrase: string; storePath: string }> {
  const { keyStore, driver, roster, userDataPath, username, password } = opts;

  const openPath = join(userDataPath, storePath(UNAUTHENTICATED_STORE_SLOT));
  if (storeFileState(openPath) !== "plaintext") {
    throw new Error(
      "An account can only be created from an unencrypted store on this device.",
    );
  }

  // 1. Account rows go in while the store is plaintext, so the copy takes them.
  const { accountId, recoveryPhrase, dbKey, passwordSidecar } =
    await createLocalAccount({
      keyStore,
      driver,
      username,
      password,
      platform: "desktop",
    });

  const encryptedPath = join(userDataPath, storePath(accountId));
  await opts.closeStore();

  await clearUnclaimedDestination({ path: encryptedPath, accountId, roster });

  // 2. Convert. The original survives this on purpose.
  convertStoreToEncrypted({
    fromPath: openPath,
    toPath: encryptedPath,
    key: dbKey,
  });

  // 2b. Before the roster entry, so an Authenticated device always has the
  //     password door. The boot path seals the recovery sidecar every launch.
  writeSidecar(passwordSidecarPath(encryptedPath), passwordSidecar);

  // 3. Past this line the device is Authenticated.
  await roster.add({
    id: accountId,
    username,
    createdAt: new Date().toISOString(),
  });

  // 4. Only now destroy the plaintext original.
  destroyStoreFiles(openPath);
  rmSync(dirname(openPath), { recursive: true, force: true });

  return { accountId, recoveryPhrase, storePath: encryptedPath };
}
