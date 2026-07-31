import { DATABASE_KEY, type KeyStore, RECOVERY_KEY } from "@leapsake/crypto";

/**
 * **Sign out** (`model.md` §7.3) — the deliberate half of the Locked state.
 *
 * Locked is a *state*, not an affordance: the store is closed and the password
 * reopens it. Sign out is the one user action that reaches it in v0.1 (automatic
 * locking on idle is deferred to v0.2). The action itself is tiny — the whole of
 * it is forgetting the keys that open this device's store — because the boot path
 * already knows how to prompt for them: dropping the db-key puts the next open
 * into `openAppDatabase`'s "the enclave is gone but the encrypted file survives"
 * case, which is the unlock gate.
 */

/**
 * The keystore secrets that open this device's store, and therefore the exact set
 * sign out must clear. Both, not one.
 *
 * **Why the recovery key is on this list.** `<db>.recovery` holds
 * `seal(db-key, recoveryKey)` and sits beside the store in plain view. Leaving the
 * recovery key in the keychain would leave that pair intact — keychain + sidecar
 * reconstructs the db-key with no user secret involved — so clearing only
 * {@link DATABASE_KEY} would make sign out *theater*: the file would look locked
 * while anything holding the keychain could still open it. The 24 words the user
 * wrote down are unaffected; they open the sidecar directly.
 *
 * This is deliberately a **subset** of `KEYSTORE_SECRET_IDS` (which a factory
 * reset clears in full). See {@link lockThisDevice} for why the other two must
 * survive.
 */
export const STORE_DOOR_SECRET_IDS = [DATABASE_KEY, RECOVERY_KEY] as const;

/**
 * Forget the keys that open this device's store, so the next open must go through
 * a door the user opens with a secret. The caller closes the store's handle and
 * re-opens it; that re-open is what raises the gate.
 *
 * **`device-id` and `enclave` are deliberately left alone.** They look like key
 * material worth clearing and are the opposite — clearing them is both unnecessary
 * and destructive:
 *
 * - *Unnecessary*, because they open nothing on their own. The enclave secret's
 *   only job is to unwrap `wrap(MK, enclave)`, and that row lives **inside** the
 *   encrypted store. With the db-key gone the row is unreachable, so the secret
 *   guards a lock with no door.
 * - *Destructive*, because {@link ensureDeviceMasterKey} keys its lookup on the
 *   device id. A fresh id finds no `key_wrap` row, so it mints a **new master
 *   key** and writes a second wrap row — orphaning every content key wrapped under
 *   the old MK and changing this device's identity on the account. Signing out and
 *   back in must be a no-op for everything above the at-rest layer, and this is
 *   what makes it one.
 *
 * Idempotent: `deleteSecret` treats an absent id as success, so signing out twice
 * (or signing out an already-locked device) is harmless.
 *
 * **Not a guard.** Whether this device is even *in* a state where locking is safe
 * — an account exists, and a door to re-open with exists beside the store — is the
 * caller's question, because only the caller can see the store's sidecars. Calling
 * this on a device with no password door strands the user behind a phrase-only
 * gate; on an Unauthenticated store it would do nothing at all, since there are no keys.
 */
export async function lockThisDevice(opts: {
  keyStore: KeyStore;
}): Promise<void> {
  for (const id of STORE_DOOR_SECRET_IDS) {
    await opts.keyStore.deleteSecret(id);
  }
}
