import type { KeyStore } from "@leapsake/crypto";
import { type SqliteDriver, createSyncStateRepo } from "@leapsake/data";
import {
  type AdoptionDoor,
  type KeySession,
  adoptAccountMasterKey,
  ensureDeviceMasterKey,
} from "./session.js";

/**
 * Rewind this device's sync watermarks so the next cycle re-pushes everything it
 * holds and re-reads the whole remote log. The companion to
 * {@link adoptAccountMasterKey}: run it when that returns `"adopted"`.
 *
 * ### Why a repair is not enough on its own
 *
 * A device whose enclave drifted onto a stray master key did not merely stop
 * syncing — it damaged the account in both directions, and neither half self-heals:
 *
 * - **Outbound**, it pushed records sealed under a key no peer holds. Peers pulled
 *   them, failed to open them, and *advanced past them* — the engine skips a bad
 *   record rather than stalling on it forever. Those
 *   records will never be offered again.
 * - **Inbound**, the same skip-and-advance happened here for every peer record this
 *   device could not open.
 *
 * Fixing the key stops new damage and repairs neither. Rewinding does: re-pushed
 * records are appended to the relay's log at fresh sequence numbers, so peers pull
 * them as new, and a pull cursor of zero re-delivers everything this device
 * discarded. Both halves are safe to repeat — merge is last-write-wins on
 * `updatedAt`, so a record that survived the outage converges to itself.
 *
 * The cost is one large sync immediately after a repair, which is the right trade
 * against silently holed history.
 */
export async function resyncAfterMasterKeyRepair(opts: {
  driver: SqliteDriver;
}): Promise<void> {
  const syncState = createSyncStateRepo(opts.driver);
  await syncState.setPushHwm(0);
  await syncState.setPullCursor(0);
}

/**
 * What a boot established about this device's master key: either a usable session
 * (or none at all, on an Unauthenticated store), or the *Degraded* state — the store opened
 * and the data is readable, but this device cannot prove which master key is the
 * account's, so it must not sync.
 */
export type BootKeySession =
  | {
      state: "ok";
      keySession: KeySession | undefined;
      /**
       * What the door repair did — `"adopted"` only when this device's enclave was
       * genuinely taught a different key, which is also what triggers the watermark
       * rewind. Absent when no door was used, i.e. on an ordinary launch. Clients
       * have no use for it; it is how the boot suites tell the two apart.
       */
      repair?: "adopted" | "unchanged";
    }
  | { state: "degraded"; message: string; cause: unknown };

/**
 * The boot path's key-custody half, start to finish: repair a device that came back
 * through an unlock door, finish a repair a previous boot left half-done, and hand
 * back the key session the core is built around — **or** report that this device is
 * Degraded, without throwing.
 *
 * Both clients and the desktop boot-integration harness call this one function.
 * That is deliberate: the *ordering* below is load-bearing in several directions at
 * once and was previously written out three times, where it could drift.
 *
 * ### Where it runs
 *
 * Between `runMigrations` (the repair reads `account`/`key_wrap`) and `createCore`,
 * **synchronously** — the launch-time recovery-escrow catch-up publishes
 * `wrap(recoveryKey, MK)` *to the relay*, so a stray key reaching it would turn one
 * device's local problem into an account-wide one (custody slice 8).
 *
 * ### Degraded, rather than refusing to open *(custody slice 10)*
 *
 * Slice 9 shipped this strict: a repair had to succeed or the app refused to open.
 * That was the honest failure while there were no users, but it fails a real person
 * badly — the app simply does not start, for a cause they can neither see nor act
 * on. So a failed repair now degrades instead:
 *
 * - **no key session**, which is already every client's "do not sync" signal, so
 *   nothing is pushed, nothing is pulled, and — crucially — the escrow catch-up
 *   cannot publish a key this device cannot vouch for;
 * - **nothing is minted**: {@link ensureDeviceMasterKey}'s refusal to mint over an
 *   existing account is caught here, never relaxed. That refusal *is* the
 *   invariant; the Degraded state is the consequence of honoring it;
 * - the store still opens, so the user keeps their app, and anything they write
 *   while degraded still reaches the account — the rewind above re-pushes it once
 *   the device is repaired.
 *
 * The way out is the unlock gate: sign out and come back through the *other* door
 * (a phrase door is unaffected by a broken password door and vice versa). The
 * clients surface `message` and that route.
 */
export async function establishKeySession(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  custody: "plaintext" | "encrypted";
  /** Set when this boot came through the unlock gate, carrying that door's key
   *  material — never the password itself (see {@link AdoptionDoor}). */
  door?: AdoptionDoor;
  platform?: string;
}): Promise<BootKeySession> {
  const { keyStore, driver, custody, door, platform } = opts;

  // An Unauthenticated store has no account, no master key, and no repair to attempt — and
  // must not acquire one here: minting is account creation's job (model.md §7.2.1).
  if (custody === "plaintext") return { state: "ok", keySession: undefined };

  const syncState = createSyncStateRepo(driver);
  let repair: "adopted" | "unchanged" | undefined;

  if (door !== undefined) {
    // Set *before* the adopt, not after. The pair "adopt the key" + "rewind the
    // watermarks" is two durable writes, and a crash between them leaves this
    // device holding the right key with its history holed — exactly the damage the
    // repair exists to undo. Setting the flag afterwards would leave that window
    // open, which is the whole reason it is durable rather than a local variable.
    await syncState.setMasterKeyRepairPending(true);
    try {
      repair = await adoptAccountMasterKey({
        keyStore,
        driver,
        door,
        platform,
      });
    } catch (cause) {
      // Degraded, with the flag left set: a device that cannot establish the
      // account's key must not sync, and the next successful repair still owes the
      // rewind. Every cause here is worded for a reader already (a drifted password
      // door, a door with no wrap row), so carry the message through.
      return { state: "degraded", message: messageOf(cause), cause };
    }
    // Only a real repair rewinds. A plain sign-out keeps the device id and enclave
    // secret, so the ordinary unlock returns `"unchanged"` — rewinding there would
    // charge every sign-out a full re-push and re-pull of the account.
    if (repair === "adopted") await resyncAfterMasterKeyRepair({ driver });
    await syncState.setMasterKeyRepairPending(false);
  } else if (await syncState.getMasterKeyRepairPending()) {
    // No door, but a repair was outstanding: a previous boot died between adopting
    // the key and rewinding. Rewind now — conservatively, because "adopted" and
    // "unchanged" are no longer distinguishable from here. One redundant full sync
    // converges by last-write-wins; a missed one holes the history for good.
    await resyncAfterMasterKeyRepair({ driver });
    await syncState.setMasterKeyRepairPending(false);
  }

  try {
    return {
      state: "ok",
      keySession: await ensureDeviceMasterKey({ keyStore, driver }),
      repair,
    };
  } catch (cause) {
    // The case no door can reach: an account row, a lost `device-id`/`enclave`, but
    // a db-key that still opens the store — so nothing raised the gate and there is
    // no door to repair from. `ensureDeviceMasterKey` refuses to mint over an
    // account (which is correct), so this device is Degraded until it comes back
    // through a door. Flag it, so the repair that eventually runs also rewinds.
    await syncState.setMasterKeyRepairPending(true);
    return { state: "degraded", message: messageOf(cause), cause };
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
