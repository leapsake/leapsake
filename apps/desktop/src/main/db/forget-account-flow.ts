import { rmSync } from "node:fs";
import { join } from "node:path";
import type { KeyStore } from "@leapsake/crypto";
import { lockThisDevice } from "@leapsake/core";
import { type AccountRoster, storeDir } from "@leapsake/store-layout";

/**
 * **Forget account** (`model.md` §7.3) — remove one account and its data from
 * *this* device. The destructive sibling of sign out, and named as removal
 * precisely so it can never be mistaken for it.
 *
 * Two actions share this neighbourhood and must stay distinct:
 *
 * | | What it removes |
 * |---|---|
 * | **Sign out** | the keys, until the password comes back (`lockThisDevice`) |
 * | **Forget account** (here) | this account's store, doors, and roster entry |
 *
 * It is **local only** — it never contacts the relay. An account registered
 * elsewhere goes on existing on the relay and on its other devices; this detaches
 * and erases *this* one. What that means for the user depends on whether any copy
 * survives, which is `fetchRelayCapabilities`' question, asked before the
 * confirmation is worded (§7.3.1) rather than here.
 *
 * Deliberately **not** a `factoryResetFiles` call with a narrower argument list.
 * Factory reset erases the whole `stores/` tree, the roster, and every keystore
 * secret; this removes one account's slot and leaves the device's identity
 * (`device-id`, `enclave`) intact, so a device holding a second account — or one
 * that later creates a new one — is unaffected.
 */
export async function forgetAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  roster: AccountRoster;
  userDataPath: string;
  /** The account to forget — the roster id, which is also its store directory. */
  accountId: string;
  /** Close the store's handle; the files cannot be removed while one is open. */
  closeStore: () => Promise<void>;
}): Promise<void> {
  const { keyStore, roster, userDataPath, accountId } = opts;

  if (!(await roster.list()).some((account) => account.id === accountId)) {
    throw new Error("That account is not on this device.");
  }

  await opts.closeStore();

  // The order is chosen for what a crash *between* two steps leaves behind.
  //
  // 1. The roster entry, first. It is the account's existence on this device —
  //    what the next boot reads to decide custody — so dropping it first means
  //    the device immediately stops claiming an account it is in the middle of
  //    erasing. The reverse order is worse: a roster still naming a store whose
  //    files are gone sends the Protected boot path off to create a *fresh empty
  //    encrypted store* at that path, presenting the user with an empty app under
  //    the account they thought they had deleted.
  //
  //    The cost is one inert failure mode: a crash before step 2 strands a
  //    ciphertext directory nothing will ever open again, since `resolveActiveStore`
  //    can only name stores the roster lists. It cannot collide with anything
  //    later either — account ids are UUIDs.
  await roster.remove(accountId);

  // 2. The store and everything beside it: `leapsake.db`, its WAL/SHM sidecars,
  //    and both db-key doors (`.password`, `.recovery`). Removing the *directory*
  //    rather than a list of filenames is what guarantees no door outlives the
  //    store it opened. `force` treats an already-absent path as success, so a
  //    retry after a partial failure completes cleanly.
  rmSync(join(userDataPath, storeDir(accountId)), {
    recursive: true,
    force: true,
  });

  // 3. The keys that opened it. They are this device's copies of *that store's*
  //    db-key and recovery key, and the store is gone, so they now open nothing —
  //    but leaving them behind would strand secrets for data the user just asked
  //    to be rid of, and would hand a subsequent account creation a stale db-key.
  //
  //    This is the same clearing sign out performs, and it stops in the same place
  //    for the same reason: `device-id` and `enclave` survive, because they are the
  //    device's identity rather than this account's, and re-minting them costs any
  //    remaining account its master key (see `lockThisDevice`).
  await lockThisDevice({ keyStore });
}
