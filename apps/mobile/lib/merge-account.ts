import * as SQLite from "expo-sqlite";
import {
  type KeyStore,
  RECOVERY_KEY,
  ensureDatabaseKey,
  rawKeyLiteral,
} from "@leapsake/crypto";
import {
  type KeySession,
  type PasswordDoorWriter,
  clearLocalAccount,
  getSyncStatus,
} from "@leapsake/core";
import type { SqliteDriver } from "@leapsake/data";
import { type AccountRoster, storePath } from "@leapsake/store-layout";
import {
  clearUnclaimedDestination,
  destroyStoreFiles,
  rekeyStore,
  storeState,
} from "../db/convert-store";
import { accountDoors } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";

/**
 * **Merging a local-only account into a synced one** (`encryption/model.md` §7.2.2)
 * — mobile's half, and the counterpart of desktop's
 * `apps/desktop/src/main/db/merge-account-flow.ts`. The two are deliberately the
 * same *order* for the same reasons; only the storage verbs differ, because mobile
 * has no user-reachable filesystem (doors are rows in a database beside the store,
 * not sidecar files, and a store is a *name* rather than a path).
 *
 * It serves one invariant: *a local store must always be mergeable into an
 * authenticated synced account.* A user who takes the wrong branch at the
 * create/sign-in fork loses **time, never work**. The Unauthenticated case is the
 * join path's, in `core-context.tsx`; this is the Authenticated one — a device that
 * already minted its own account, encrypted its store under it, and now wants to
 * log in to an account that exists elsewhere.
 *
 * The store is **re-homed**, not re-keyed. The at-rest db-key is minted per
 * *device*, not per account (`model.md` §7.1), so both of this device's stores are
 * locked with the same key and {@link rekeyStore} is called with the same key both
 * ways. What changes is the name the store lives under, the account row inside it,
 * and which password opens it.
 *
 * ### Why the relay half runs against a copy
 *
 * `joinAccountViaRelay` refuses while a local account row is present, so this flow
 * has to call {@link clearLocalAccount} first. Doing that to the **live** store —
 * the ordering the join path uses, where the relay call comes before the
 * conversion — would mean a wrong password or an unreachable relay had already
 * destroyed the user's local account identity in place. That is the one time it
 * must not happen, and it is reached by *failing*, which is why a happy-path demo
 * would never show it.
 *
 * So the order is inverted: **copy first, and mutate only the copy.** Everything
 * destructive happens to a store no roster entry names, which means a failure
 * anywhere before the roster write is undone by deleting it. There is no rollback
 * path to write, and the live store is never touched at all — the caller simply
 * re-runs the bootstrap onto it.
 *
 * ### The one thing copy-first cannot protect
 *
 * The join writes the account's recovery key into the **device** keychain, which
 * is process-global and outside any store. Worse, a clean throw after that point
 * is not merely a crash window: the caller's failure path re-runs the bootstrap
 * immediately, and that boot re-seals the *local* store's recovery door from
 * whatever the keychain now holds (`core-context.tsx`, "Refresh the recovery
 * sidecar … on every launch"). The abandoned store's phrase door would die inside
 * the same failed call. Hence the explicit restore in the `catch` below — the only
 * rollback line in this flow, and load-bearing.
 *
 * ### Crash ordering
 *
 * Start: roster `[L]`, `stores/L/` holding the store and both doors, keychain
 * holding this device's db-key and `R_local`.
 *
 * | Killed after | Roster | On disk | Next boot | Outcome |
 * |---|---|---|---|---|
 * | prelogin, `closeStore` | `[L]` | `stores/L` | L | nothing happened |
 * | the sweep | `[L]` | an *unclaimed* `stores/S` removed | L | nothing happened |
 * | the copy | `[L]` | `stores/L` + a bare `stores/S` | L | **original intact**; the retry's sweep clears `stores/S` |
 * | `clearLocalAccount` | `[L]` | `stores/S` has no account row | L | the mutation was on the copy; L never changed |
 * | the relay half | `[L]` | `stores/S` complete, no password door | L | **the one lossy edge** — L still opens on its password and its enclave, but its recovery door is re-sealed under the account's key while its master-key recovery wrap is under `R_local`, so L's *phrase* door is dead |
 * | the password door | `[L]` | `stores/S` complete | L | as above |
 * | **the roster swap** | **`[S]`** | both stores | **S — merged** | one write; the point of no return |
 * | destroying L | `[S]` | `stores/S` | S | finished |
 *
 * The gap between the last two rows leaves `stores/L/` as an inert, unreferenced
 * ciphertext store. Accepted, for the reason `forget-account.ts` already gives for
 * the identical shape.
 *
 * > **Do not add a boot-time sweeper for encrypted stores the roster does not
 * > name.** It looks like the tidy answer and it is a data-loss engine: the roster
 * > parser deliberately degrades unreadable content to *empty* so a corrupt row
 * > cannot brick the boot, and a sweeper keyed on roster absence would turn that
 * > recoverable boot into the irreversible deletion of every store on the device.
 * > (The boot sweep that *does* exist is narrower on purpose: it names the one
 * > fixed Unauthenticated slot, which no account can ever be homed at.)
 *
 * ### What rides along in the copy
 *
 * `sync_state` crosses with everything else, which is correct: `pull_cursor` is
 * null (a local-only account has never pulled) and the recovery escrow cannot be
 * pending (`rotateRecoveryPhraseForAccount` returns before arming it for an
 * account with no relay), so `auto_sync_enabled` is the only carried preference.
 * `reconcileOnJoin` is **not** run here — the caller runs it after the swap, and
 * both of its preconditions are what this flow leaves behind: the local people
 * rows survived the copy, and the account is now relay-bound.
 */
export async function mergeAccountOnThisDevice(opts: {
  keyStore: KeyStore;
  /**
   * The live store, which must hold a local-only account. Read once for its
   * identity, then closed and never touched again.
   */
  driver: SqliteDriver;
  roster: AccountRoster;
  /** The synced account's username, as the roster label if its store has none. */
  username: string;
  /**
   * Prelogin against the relay: the synced account's id, before any password is
   * checked. The destination store is named after it, so it has to be known
   * before a single row is copied.
   */
  prelogin: () => Promise<{ accountId: string }>;
  /**
   * Join the synced account **against the copy's driver** — not the live one —
   * sealing this device's password door through the given
   * {@link PasswordDoorWriter}.
   */
  adopt: (
    driver: SqliteDriver,
    writePasswordSidecar: PasswordDoorWriter,
  ) => Promise<KeySession>;
  /** Close the live handle; the copy needs the source store quiescent. */
  closeStore: () => Promise<void>;
}): Promise<{ accountId: string }> {
  const { keyStore, driver, roster } = opts;

  // 0. Guards, while nothing has moved. Each states what this door is for, the
  //    way the join path asserts its own plaintext source rather than coping
  //    with anything else.
  const local = await getSyncStatus({ driver });
  if (!local.hasAccount || local.accountId === undefined) {
    throw new Error(
      "This device has no account to merge. Log in from Settings instead.",
    );
  }
  if (local.relayUrl !== undefined) {
    throw new Error("This device is already signed in to an account.");
  }

  const localId = local.accountId;
  const localName = storePath(localId);

  // The roster is what the boot path reads, so a store it does not name is not
  // the one being merged, whatever this driver says.
  if (!(await roster.list()).some((a) => a.id === localId)) {
    throw new Error("This device's account is not in its roster.");
  }
  if ((await storeState(localName)) !== "encrypted") {
    throw new Error("This device's store is not an encrypted database.");
  }

  // 1. This device's existing at-rest key. `ensureDatabaseKey` returns rather
  //    than mints here — the device is already Authenticated — which is why the
  //    same key goes both ways below.
  const dbKey = await ensureDatabaseKey(keyStore);

  // 2. Where the store is moving to. Before `closeStore` on purpose: the network
  //    is the part that fails, and failing while the store is still open costs
  //    the caller only a scheduler restart, not a re-open.
  const { accountId: syncedId } = await opts.prelogin();
  if (syncedId === localId) {
    throw new Error("This device already holds that account.");
  }
  // The converter's overwrite guard sees an absent-or-present *store*; it cannot
  // see a *claim*. On the create and join paths a claimed destination is
  // unreachable, but here the user picks the account, so it is a real input.
  if ((await roster.list()).some((a) => a.id === syncedId)) {
    throw new Error("This device already holds that account.");
  }

  const syncedName = storePath(syncedId);
  await opts.closeStore();

  // 3. Clear a destination abandoned by an earlier attempt, so the copy below is
  //    not refused by the overwrite guard.
  await clearUnclaimedDestination({ accountId: syncedId, roster });

  // 4. The re-home. Same key both ways — the store moves, its lock does not.
  //    Nothing about the original has changed, and nothing does until step 8.
  await rekeyStore({
    fromName: localName,
    fromKey: dbKey,
    toName: syncedName,
    toKey: dbKey,
  });

  const priorRecoveryKey = await keyStore.getSecret(RECOVERY_KEY);
  let username: string | undefined;
  try {
    // 5. Open the copy directly, not by re-running the bootstrap. No migrations
    //    are needed (the copy carries `user_version` across), there is no unlock
    //    gate to satisfy — and, load-bearing, the bootstrap would write a
    //    recovery door sealed under the key the relay half is about to replace.
    const copy = await openStoreUnderKey(syncedName, dbKey);
    try {
      // 6. Retire the local account *inside the copy*. This is the only reason
      //    the copy has to exist before the relay call: joining refuses while an
      //    account row is present.
      await clearLocalAccount({ driver: copy });

      // 7. The relay half, with the password door captured rather than written —
      //    the writer this provider hands core resolves against the *live*
      //    account's doors, which is the store this flow is retiring.
      let passwordDoor: Uint8Array | undefined;
      await opts.adopt(copy, async (bytes) => {
        passwordDoor = bytes;
      });
      if (passwordDoor === undefined) {
        throw new Error(
          "Logging in did not seal this device's password door; refusing to " +
            "complete the merge.",
        );
      }

      // Prelogin ran twice — once here, once inside the join. They address the
      // same relay and should agree; if they ever did not, this store would be
      // homed under one id while carrying another's account row, which no later
      // step could detect.
      const joined = await getSyncStatus({ driver: copy });
      if (joined.accountId !== syncedId) {
        throw new Error(
          "Logging in landed on a different account than this store was moved to.",
        );
      }
      username = joined.username;

      await copy.close?.();
      // 8. The password door, in the store's own directory, before the roster
      //    entry — so a device that is on the synced account from the next boot
      //    onward has had both from the same moment.
      await accountDoors(syncedId).writePassword(passwordDoor);
    } catch (cause) {
      await copy.close?.().catch(() => {});
      throw cause;
    }
  } catch (cause) {
    // The keychain is device-global, so the copy cannot contain this one. Left
    // alone, the account's recovery key would be re-sealed into the *abandoned*
    // local store's recovery door by the bootstrap the caller is about to
    // re-run, silently killing that store's phrase door on a merge that failed.
    if (priorRecoveryKey === undefined)
      await keyStore.deleteSecret(RECOVERY_KEY);
    else await keyStore.setSecret(RECOVERY_KEY, priorRecoveryKey);

    // Best-effort, as in the converter: reporting the failure outranks tidying.
    // The destination is unclaimed by construction — the roster still names L —
    // so this can only remove what this call created.
    try {
      await destroyStoreFiles(syncedName);
    } catch {
      // Nothing actionable, and the original error is the one worth raising.
    }
    await accountDoors(syncedId).destroy();
    throw cause;
  }

  // 9. One write, swapping which account this device holds. Past this line the
  //    merge has happened; before it, nothing had.
  await roster.replace(localId, {
    id: syncedId,
    username: username ?? opts.username,
    createdAt: new Date().toISOString(),
  });

  // 10. Only now destroy the original — the store, then the now-meaningless
  //     password and recovery doors that opened it. Doors last, so a crash can
  //     never leave a door outliving its store (`forget-account.ts` gives the
  //     same ordering the same reason).
  await destroyStoreFiles(localName);
  await accountDoors(localId).destroy();

  return { accountId: syncedId };
}

/**
 * Open an already-migrated encrypted store under `key` and prove the key opens
 * it — mobile's stand-in for desktop's `openEncryptedDatabase`, which this flow
 * needs because it must reach a store that is not the live one.
 *
 * The proof read is not optional. Applying a key never fails on its own; only the
 * first *read* does, so without this a stale key would surface much later as
 * SQLCipher's "file is not a database", from inside whichever statement happened
 * to touch the file first.
 *
 * Exported for the one caller downstream of the merge: the post-swap
 * `reconcileOnJoin` runs on the merged store, and mobile's re-open is a bootstrap
 * effect it cannot await (see `core-context.tsx`'s `merge`). Not a general
 * store-opening helper — it runs no migrations and satisfies no unlock gate, so
 * it is only correct for a store this device just wrote.
 */
export async function openStoreUnderKey(
  name: string,
  key: Uint8Array,
): Promise<SqliteDriver> {
  const driver = expoSqliteDriver(await SQLite.openDatabaseAsync(name));
  await driver.exec(`PRAGMA key = "${rawKeyLiteral(key)}"`);
  try {
    await driver.get("PRAGMA user_version");
  } catch (cause) {
    await driver.close?.().catch(() => {});
    throw new Error("Failed to open the copied store — wrong or missing key.", {
      cause,
    });
  }
  return driver;
}
