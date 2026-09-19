import { rmSync } from "node:fs";
import { join } from "node:path";
import type { KeyStore } from "@leapsake/crypto";
import { lockThisDevice } from "@leapsake/core";
import { type AccountRoster, storeDir } from "@leapsake/store-layout";

/**
 * Remove one account's store, doors, roster entry and keys from this device,
 * locally only. The device's identity keys survive for any other account.
 */
export async function forgetAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  roster: AccountRoster;
  userDataPath: string;
  /** The roster id, which is also its store directory. */
  accountId: string;
  /** Close the handle; the files cannot be removed while one is open. */
  closeStore: () => Promise<void>;
}): Promise<void> {
  const { keyStore, roster, userDataPath, accountId } = opts;

  if (!(await roster.list()).some((account) => account.id === accountId)) {
    throw new Error("That account is not on this device.");
  }

  await opts.closeStore();

  // Roster entry first: see the desktop README → *Invariants*.
  await roster.remove(accountId);

  // The whole directory, so no door outlives the store it opened.
  rmSync(join(userDataPath, storeDir(accountId)), {
    recursive: true,
    force: true,
  });

  // The same clearing sign out performs; leaving them would hand the next
  // account creation a stale db-key.
  await lockThisDevice({ keyStore });
}
