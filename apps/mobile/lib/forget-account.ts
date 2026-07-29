import type { KeyStore } from "@leapsake/crypto";
import { lockThisDevice } from "@leapsake/core";
import type { AccountRoster } from "@leapsake/store-layout";

/**
 * **Forget account** (`model.md` §7.3), mobile's half — remove one account and its
 * data from this device. The counterpart to desktop's
 * `main/db/forget-account-flow.ts`, and deliberately the same *order* for the same
 * reasons; only the storage verbs differ, which is why they are injected.
 *
 * Two actions share this neighbourhood and must stay distinct:
 *
 * | | What it removes |
 * |---|---|
 * | **Sign out** | the keys, until the password comes back (`lockThisDevice`) |
 * | **Forget account** (here) | this account's store, doors, and roster entry |
 *
 * It is **local only** — it never contacts the relay. An account registered
 * elsewhere goes on existing on the relay and on its other devices. Whether that
 * makes this a deletion is `fetchRelayCapabilities`' question, asked before the
 * confirmation is worded (§7.3.1) rather than here.
 *
 * Not a `factoryReset` with a narrower reach: that erases *every* store, the whole
 * roster, and every keystore secret. This removes one account's slot and leaves
 * the device's identity (`device-id`, `enclave`) intact.
 *
 * > **The doors are device-scoped on mobile, not per-account.** Desktop keeps them
 * > as files beside each store, so they scope themselves; mobile keeps both in one
 * > unencrypted database keyed `id = 1` (`db/sidecars.ts`), so `deleteDoors` drops
 * > *this device's* pair rather than one account's. Correct while a device holds
 * > one account — the shape actually supported, since the keystore likewise has a
 * > single `db-key` slot — and a real constraint to revisit with the login picker.
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
  /** Drop both db-key doors (`deleteSidecars`). */
  deleteDoors: () => Promise<void>;
}): Promise<void> {
  const { keyStore, roster, accountId } = opts;

  if (!(await roster.list()).some((account) => account.id === accountId)) {
    throw new Error("That account is not on this device.");
  }

  // The order is chosen for what a crash *between* two steps leaves behind, and
  // matches desktop step for step.
  //
  // 1. The roster entry, first: it is the account's existence on this device, and
  //    what the next bootstrap reads to decide custody. Dropping it first means a
  //    crash lands the device Open — recoverable — rather than Protected and
  //    pointed at a store that no longer exists, which would send the boot path
  //    off to mint a fresh empty encrypted store under the account the user
  //    thought they had just deleted.
  await roster.remove(accountId);

  // 2. The store, then the doors that opened it. Doors last so a crash can never
  //    leave a door outliving its store — the direction that matters, since the
  //    reverse would strand an openable store with no way to name it.
  await opts.deleteStore(opts.storeName);
  await opts.deleteDoors();

  // 3. The keys that opened it. The store is gone so they open nothing, but
  //    leaving them would strand secrets for data the user just asked to be rid
  //    of, and hand a later account creation a stale db-key. Stops where sign out
  //    stops, for the same reason: `device-id` and `enclave` are the device's
  //    identity, and re-minting them costs any remaining account its master key.
  await lockThisDevice({ keyStore });
}
