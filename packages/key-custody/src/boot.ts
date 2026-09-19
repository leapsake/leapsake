import type { KeyStore } from "@leapsake/crypto";
import { type SqliteDriver, createSyncStateRepo } from "@leapsake/data";
import {
  type AdoptionDoor,
  type KeySession,
  adoptAccountMasterKey,
  ensureDeviceMasterKey,
} from "./session.js";

/**
 * Rewind the sync watermarks so the next cycle re-pushes and re-pulls
 * everything, restoring records skipped while the key drifted. Safe to repeat.
 */
export async function resyncAfterMasterKeyRepair(opts: {
  driver: SqliteDriver;
}): Promise<void> {
  const syncState = createSyncStateRepo(opts.driver);
  await syncState.setPushHwm(0);
  await syncState.setPullCursor(0);
}

/** A boot's key session: usable, absent (Unauthenticated), or Degraded, where
 *  the store opens but must not sync. */
export type BootKeySession =
  | {
      state: "ok";
      keySession: KeySession | undefined;
      /** What the door repair did, absent on an ordinary launch; for the boot
       *  suites. */
      repair?: "adopted" | "unchanged";
    }
  | { state: "degraded"; message: string; cause: unknown };

/**
 * The boot's key-custody half: repair after a door unlock, finish a half-done
 * repair, and return the key session, or Degraded without throwing.
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

  // Unauthenticated: no account, no master key, nothing to repair, and none is
  // minted here; that is account creation's job.
  if (custody === "plaintext") return { state: "ok", keySession: undefined };

  const syncState = createSyncStateRepo(driver);
  let repair: "adopted" | "unchanged" | undefined;

  if (door !== undefined) {
    // Set before the adopt, so a crash between adopt and rewind still rewinds.
    await syncState.setMasterKeyRepairPending(true);
    try {
      repair = await adoptAccountMasterKey({
        keyStore,
        driver,
        door,
        platform,
      });
    } catch (cause) {
      // Degraded, flag left set: the next successful repair still owes the
      // rewind. Every cause is already worded for a reader.
      return { state: "degraded", message: messageOf(cause), cause };
    }
    // Only a real repair rewinds; a plain sign-out answers "unchanged".
    if (repair === "adopted") await resyncAfterMasterKeyRepair({ driver });
    await syncState.setMasterKeyRepairPending(false);
  } else if (await syncState.getMasterKeyRepairPending()) {
    // A previous boot died between adopt and rewind; rewind conservatively.
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
    // An account with a lost keychain but an openable store: no door to repair
    // from, so Degraded, flagged so the eventual repair also rewinds.
    await syncState.setMasterKeyRepairPending(true);
    return { state: "degraded", message: messageOf(cause), cause };
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
