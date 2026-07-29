/**
 * `@leapsake/key-custody` — how this device **obtains, holds, escrows, and
 * relinquishes** the account master key. It is the code counterpart to
 * [`plans/encryption/model.md`](../../plans/encryption/model.md) §7.5 (the key
 * lifecycle, phase by phase), and its exports follow that section's phases:
 *
 * - **Phase 0, the enclave bootstrap** — {@link ensureDeviceMasterKey} mints or
 *   reads the device MK through the `KeyStore` port, the first thing to run after
 *   migrations and before the core exists.
 * - **Phases 1–2, the password door** — {@link enableSync} adds the password and
 *   recovery wrappings of MK; {@link unlockWithPassword} and
 *   {@link unlockWithRecoveryKey} open it again from the password or the recovery
 *   phrase alone, with no enclave involved. {@link sealPasswordDoor} is the same
 *   door one layer down, on the *at-rest* db-key: the sidecar read before the
 *   database can open at all.
 * - **Adoption and repair** — {@link joinAccount} (a second device),
 *   {@link recoverAccount} (a forgotten password), {@link reauthenticate} (a
 *   password changed elsewhere).
 * - **Relinquish** — {@link lockThisDevice} (sign out: forget the keys that open
 *   the store, so the password is needed again) and {@link KEYSTORE_SECRET_IDS},
 *   the full set of secrets a factory reset must erase. {@link clearLocalAccount}
 *   sits here too, but is a *rollback* rather than a user action: it undoes the
 *   account rows when relay registration fails mid-creation.
 *
 * It is a package rather than a `core` module because it is neither a
 * transactional write nor a view-model: it is an application service over
 * `crypto` (the primitives) and three `data` repos (account/device/key-wrap),
 * with no dependency on the entity surface `core` composes.
 *
 * **The relay is a port, not a dependency.** {@link joinAccount} and
 * {@link recoverAccount} take an {@link AccountBootstrapChannel} /
 * {@link RecoveryChannel} — the narrow slice of the bootstrap calls they use,
 * which a real `HttpSyncTransport` satisfies structurally. So custody never
 * imports `@leapsake/sync`, and the two stay independently testable.
 */
export { createLocalAccount } from "./create-account.js";
export { STORE_DOOR_SECRET_IDS, lockThisDevice } from "./lock.js";
export { sealPasswordDoor } from "./password-door.js";
export {
  KEYSTORE_SECRET_IDS,
  clearLocalAccount,
  enableSync,
  ensureDeviceMasterKey,
  getSyncStatus,
  joinAccount,
  reauthenticate,
  recoverAccount,
  unlockWithPassword,
  unlockWithRecoveryKey,
} from "./session.js";
export type {
  AccountBootstrap,
  AccountBootstrapChannel,
  KeySession,
  RecoveryChannel,
  SyncStatus,
  UnlockedMasterKey,
} from "./session.js";
