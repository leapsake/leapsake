import type { KeyStore } from "@leapsake/crypto";
import { lockThisDevice } from "@leapsake/core";
import type { AccountRoster } from "@leapsake/store-layout";

/**
 * Remove one account's roster entry, store, doors and keys from this device,
 * in desktop's order; local only, and the device's identity survives.
 */
export async function forgetAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  roster: AccountRoster;
  /** The account to forget — the roster id, which also names its store. */
  accountId: string;
  /** The store's database name, as `storePath(accountId)` forms it. */
  storeName: string;
  /** Delete a store database by name (`SQLite.deleteDatabaseAsync`). */
  deleteStore: (name: string) => Promise<void>;
  /** Drop this account's two doors only, never another account's. */
  deleteDoors: () => Promise<void>;
}): Promise<void> {
  const { keyStore, roster, accountId } = opts;

  if (!(await roster.list()).some((account) => account.id === accountId)) {
    throw new Error("That account is not on this device.");
  }

  // Roster first: a crash after it boots Unauthenticated, not into a fresh
  // empty store under the deleted account.
  await roster.remove(accountId);

  // Doors after the store, so a crash never strands an openable store.
  await opts.deleteStore(opts.storeName);
  await opts.deleteDoors();

  // Stops where sign out stops: `device-id` and `enclave` stay.
  await lockThisDevice({ keyStore });
}
