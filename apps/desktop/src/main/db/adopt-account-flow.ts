import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type KeyStore, ensureDatabaseKey } from "@leapsake/crypto";
import type {
  KeySession,
  PasswordDoorWriter,
  SqliteDriver,
} from "@leapsake/core";
import { getSyncStatus } from "@leapsake/core";
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
 * **Adopting an existing account onto this device** (`model.md` §7.1) — the join
 * and recovery counterpart to {@link createAccountOnThisDevice}.
 *
 * Joining or recovering makes this device a member of an account that already
 * exists elsewhere, and §7.1 requires such a device to be encrypted at rest before
 * any user data reaches it. The relay half of that (adopting the account master
 * key) was always here; the local half — giving this device its own db-key and
 * converting its store — was not, so every device past the first stayed plaintext
 * at rest.
 *
 * This is {@link createAccountOnThisDevice}'s irreversible half minus the key
 * minting, and it keeps that flow's ordering exactly, because the ordering is what
 * makes a crash survivable (the table in {@link convertStoreToEncrypted}):
 * **convert (original kept) → password door → roster entry → destroy the original.**
 * The one difference is where the keys come from: the account already exists
 * remotely, so this device mints only a db-key and *adopts* the master key.
 *
 * ### Why the db-key is minted before `adopt` runs
 *
 * Core seals the password door from inside `joinAccountViaRelay` /
 * `recoverAccountViaRelay`, via `sealPasswordDoorIfProtected`, which deliberately
 * skips while a store has no db-key — that is how it stayed correct while Unauthenticated
 * stores had no lock to seal. Minting first is therefore what turns that skip into
 * a real door, with no change at those call sites.
 *
 * Minting early is safe: custody is decided purely by the roster
 * (`resolveActiveStore`), and the Unauthenticated branch of the boot path never reads a
 * db-key. A crash between the mint and the roster entry still boots Unauthenticated and
 * plaintext, with a harmless unused key in the enclave that the retry reuses.
 *
 * ### Why the door's bytes are captured rather than written
 *
 * The writer the main process normally hands core resolves its path against the
 * *live* `dbPath`, which is still the Unauthenticated store while `adopt` runs — so letting it
 * write would put the door beside a plaintext store that is about to be deleted.
 * Capturing the bytes and writing them at the converted path is what
 * `createAccountOnThisDevice` already does with the bytes `createLocalAccount`
 * returns; this is the same trick for a door sealed one layer deeper.
 *
 * The caller closes the store's driver via `closeStore` and re-opens afterwards
 * (`withStoreSwap`): the file cannot be converted while a handle is writing to it,
 * and the new store is opened by the ordinary Authenticated boot path, which also seals
 * the recovery sidecar as it does on every launch — so this writes only one door.
 */
export async function adoptAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  /** The open store, which must be the plaintext one — joining is an Unauthenticated act. */
  driver: SqliteDriver;
  roster: AccountRoster;
  userDataPath: string;
  /** The username being joined, as the roster entry's label if the store has none. */
  username: string;
  /**
   * Join or recover against the relay, using the still-open store. Handed the
   * {@link PasswordDoorWriter} core should seal this device's password door with.
   */
  adopt: (writePasswordSidecar: PasswordDoorWriter) => Promise<KeySession>;
  /** Close the store's handle; the conversion needs the file quiescent. */
  closeStore: () => Promise<void>;
}): Promise<KeySession> {
  const { keyStore, driver, roster, userDataPath } = opts;

  const openPath = join(userDataPath, storePath(UNAUTHENTICATED_STORE_SLOT));

  // Joining is an **Unauthenticated** device's act, and this asserts it rather than coping.
  // There used to be a branch here that adopted in place on an already-Authenticated
  // device, because "Disconnect account" could leave one reporting no account
  // while its roster still named one; removing that button removed the only way
  // to reach this state, since every path now writes the account row and the
  // roster entry together. Refusing is the honest replacement: silently adopting
  // a second account into a store still homed under the first one's id was never
  // a state worth producing.
  if (storeFileState(openPath) !== "plaintext") {
    throw new Error(
      "This device already holds an account. Forget it before joining another.",
    );
  }

  // 1. This device's own at-rest key. Before `adopt` on purpose — see the note above.
  const dbKey = await ensureDatabaseKey(keyStore);

  // 2. The relay half, with the password door captured rather than written.
  let passwordSidecar: Uint8Array | undefined;
  const session = await opts.adopt(async (sidecar) => {
    passwordSidecar = sidecar;
  });

  // With a db-key in hand `sealPasswordDoorIfProtected` cannot legitimately skip,
  // so an unsealed door means that contract broke. Fail here, where nothing on disk
  // has moved yet, rather than hand the user a device only its phrase can open.
  if (passwordSidecar === undefined) {
    throw new Error(
      "Joining did not seal this device's password door; refusing to convert the store.",
    );
  }

  const { accountId, username } = await getSyncStatus({ driver });
  if (accountId === undefined) {
    throw new Error("Joining did not record an account on this store.");
  }

  const encryptedPath = join(userDataPath, storePath(accountId));
  await opts.closeStore();

  await clearUnclaimedDestination({ path: encryptedPath, accountId, roster });

  // 3. Convert. The original survives this on purpose.
  convertStoreToEncrypted({
    fromPath: openPath,
    toPath: encryptedPath,
    key: dbKey,
  });

  // 3b. The password door, beside the store it opens — written before the roster
  //     entry so a device that is Authenticated from the next boot onward has both
  //     doors from the same moment.
  writeSidecar(passwordSidecarPath(encryptedPath), passwordSidecar);

  // 4. Point the roster at the new store. Past this line the device is Authenticated.
  await roster.add({
    id: accountId,
    username: username ?? opts.username,
    createdAt: new Date().toISOString(),
  });

  // 5. Only now destroy the plaintext original.
  destroyStoreFiles(openPath);
  rmSync(dirname(openPath), { recursive: true, force: true });

  return session;
}
