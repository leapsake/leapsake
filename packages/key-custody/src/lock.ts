import { DATABASE_KEY, type KeyStore, RECOVERY_KEY } from "@leapsake/crypto";

/** The secrets sign out clears: the db-key, and the recovery key, which with
 *  the sidecar beside the store would reopen it with no user secret. */
export const STORE_DOOR_SECRET_IDS = [DATABASE_KEY, RECOVERY_KEY] as const;

/**
 * Sign out: forget the keys that open this store, keeping `device-id` and
 * `enclave` so signing back in mints nothing. Idempotent, and not a guard.
 */
export async function lockThisDevice(opts: {
  keyStore: KeyStore;
}): Promise<void> {
  for (const id of STORE_DOOR_SECRET_IDS) {
    await opts.keyStore.deleteSecret(id);
  }
}
