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
 * **Account creation, end to end** (`model.md` §7.2.1) — the single act that turns
 * encryption on. Mints every key, converts the Unauthenticated store to Authenticated, records
 * the account in the roster, and destroys the plaintext original.
 *
 * The step order is chosen so that a crash at *any* point leaves a launchable
 * device (see {@link convertStoreToEncrypted} for the table). In short: the
 * plaintext original outlives the conversion, and dies only once the roster points
 * at its replacement.
 *
 * The caller closes the store's driver before calling and reopens afterwards — the
 * file cannot be converted while a handle is writing to it, and the new store is
 * opened by the ordinary Authenticated boot path, which also writes the recovery
 * sidecar as it does on every launch.
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

  // 1. Keys + account rows, written into the store while it is still plaintext —
  //    the conversion copies whatever is there, so these must precede it.
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

  // 2b. The password door, beside the store it opens. Written after the
  //     conversion because that is when its destination exists, and *before* the
  //     roster entry so a device that is Authenticated from the next boot onward has
  //     both doors from the same moment. The recovery sidecar needs no step here:
  //     the Authenticated boot path seals it on every launch.
  writeSidecar(passwordSidecarPath(encryptedPath), passwordSidecar);

  // 3. Point the roster at the new store. Past this line the device is Authenticated.
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
