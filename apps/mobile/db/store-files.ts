import type { StoreFiles } from "@leapsake/account-flows";
import { storePath } from "@leapsake/store-layout";
import {
  convertStoreToEncrypted,
  copyEncryptedStore,
  destroyStoreFiles,
} from "./convert-store";
import { accountDoors } from "./doors";
import { openKeyedStore } from "./open-store";

/** Mobile's {@link StoreFiles}: each store an expo-sqlite database, its doors
 *  in `doors.db` beside it. */
export function mobileStoreFiles(opts: {
  /** The open plaintext store's name. */
  plaintextName: string;
  closeStore: () => Promise<void>;
}): StoreFiles {
  const { plaintextName } = opts;
  return {
    close: opts.closeStore,
    convertToEncrypted: (accountId, dbKey) =>
      convertStoreToEncrypted({
        fromName: plaintextName,
        toName: storePath(accountId),
        key: dbKey,
      }),
    copyAccountStore: (fromAccountId, toAccountId, dbKey) =>
      copyEncryptedStore({
        fromName: storePath(fromAccountId),
        toName: storePath(toAccountId),
        key: dbKey,
      }),
    openAccountStore: (accountId, dbKey) =>
      openKeyedStore(storePath(accountId), dbKey),
    writePasswordDoor: (accountId, door) =>
      accountDoors(accountId).writePassword(door),
    async removeAccountStore(accountId) {
      try {
        await destroyStoreFiles(storePath(accountId));
      } catch {
        // `deleteDatabaseAsync` throws for a missing file, the ordinary case.
      }
      await accountDoors(accountId).destroy();
    },
    removePlaintextStore: () => destroyStoreFiles(plaintextName),
  };
}
