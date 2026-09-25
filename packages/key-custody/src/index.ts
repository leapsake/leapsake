/** How this device obtains, holds, escrows and relinquishes the account master
 *  key. See the README for the phases and why this is a package. */
export { bindRelayToAccount } from "./bind-relay.js";
export { establishKeySession, resyncAfterMasterKeyRepair } from "./boot.js";
export type { BootKeySession } from "./boot.js";
export { createLocalAccount } from "./create-account.js";
export { STORE_DOOR_SECRET_IDS, lockThisDevice } from "./lock.js";
export { sealPasswordDoor } from "./password-door.js";
export {
  adoptRecoveryKey,
  holdsRecoveryKey,
  rotateRecoveryPhrase,
} from "./rotate-recovery.js";
export type { RecoveryDoorWriter } from "./rotate-recovery.js";
export { resealRecoveryDoor } from "./recovery-door.js";
export { unlockStore } from "./unlock.js";
export type {
  StoreDoorSidecars,
  UnlockAnswer,
  UnlockRequest,
} from "./unlock.js";
export {
  KEYSTORE_SECRET_IDS,
  MIN_PASSWORD_LENGTH,
  adoptAccountMasterKey,
  clearLocalAccount,
  enableSync,
  ensureDeviceMasterKey,
  ensureLocalDeviceId,
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
  AdoptionDoor,
  KeySession,
  RecoveryChannel,
  SyncStatus,
  UnlockedMasterKey,
} from "./session.js";
