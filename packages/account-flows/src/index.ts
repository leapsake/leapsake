/** The account flows both clients run, written once over their ports. See the
 *  README for what a client binds and what it keeps. */
export type { AccountFlowPorts, StoreFiles } from "./ports.js";
export { type SyncActivity, createAccountSync } from "./account-sync.js";
export { createAccount } from "./create-account.js";
export { joinAccount, recoverAccount } from "./join-account.js";
export { mergeIntoAccount } from "./merge-account.js";
export { reauthenticate } from "./reauthenticate.js";
export { startSyncing } from "./start-syncing.js";
export { type RelayFailure, RelayError } from "./relay-error.js";
