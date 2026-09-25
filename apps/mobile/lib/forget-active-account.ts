import type { SqliteDriver } from "@leapsake/core";
import type { KeyStore } from "@leapsake/crypto";
import type { AccountRoster, ActiveStore } from "@leapsake/store-layout";
import { forgetAccountOnThisDevice } from "./forget-account";

export interface ForgetActiveAccountPorts {
  keyStore: KeyStore;
  roster: AccountRoster;
  /** Delete a store database by name. */
  deleteStore(name: string): Promise<void>;
  doorsFor(accountId: string): { destroy(): Promise<void> };
  /** Called once the forget is certain to proceed, before the driver closes. */
  onClosing(): void;
}

/**
 * Forget the account the booted store belongs to: close its driver, then remove
 * its roster entry, store, doors and keys. Refuses an Unauthenticated store.
 */
export async function forgetActiveAccount(
  activeStore: ActiveStore,
  driver: SqliteDriver,
  ports: ForgetActiveAccountPorts,
): Promise<void> {
  const accountId =
    activeStore.custody === "encrypted" ? activeStore.accountId : undefined;
  if (accountId === undefined) {
    throw new Error("There is no account on this device to forget.");
  }
  ports.onClosing();
  await driver.close?.();
  await forgetAccountOnThisDevice({
    keyStore: ports.keyStore,
    roster: ports.roster,
    accountId,
    storeName: activeStore.path,
    deleteStore: ports.deleteStore,
    deleteDoors: () => ports.doorsFor(accountId).destroy(),
  });
}
