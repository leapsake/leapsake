// `@leapsake/sync`: how rows leave and re-enter this device; see the README.
export {
  type Cursor,
  type EncryptedRecord,
  type SyncTransport,
  createInMemoryTransport,
} from "./transport.js";
export { type SyncEngine, createSyncEngine } from "./engine.js";
export {
  type AccountRegistration,
  type HttpSyncTransport,
  type WireRecord,
  createHttpSyncTransport,
  decodeRecord,
  encodeRecord,
} from "./http-transport.js";
export {
  type RelayCapabilities,
  NO_DURABLE_BACKUP,
  fetchRelayCapabilities,
} from "./relay-capabilities.js";
export {
  type SyncScheduler,
  SYNC_INTERVAL_MS,
  SYNC_KICK_DEBOUNCE_MS,
  createSyncScheduler,
  withSyncKick,
} from "./scheduler.js";
export {
  createAccountSyncEngine,
  lookupAccount,
  lookupAccountId,
  registerAccountWithRelay,
  joinAccountViaRelay,
  recoverAccountViaRelay,
  reauthenticateViaRelay,
  isRelayAuthError,
  isUsernameTakenError,
  runAccountSync,
  rotateRecoveryPhraseForAccount,
  flushPendingRecoveryEscrow,
  convergeRecoveryKey,
  reconcileOnJoin,
  selectJoinDuplicates,
  getAutoSync,
  setAutoSync,
} from "./account.js";
export type { JoinReconcileResult, PasswordDoorWriter } from "./account.js";
