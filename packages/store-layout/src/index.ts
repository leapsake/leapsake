// Where this client keeps its stores, and which one to open; see the README.
export {
  UNAUTHENTICATED_STORE_SLOT,
  ROSTER_PATH,
  storeDir,
  storePath,
} from "./paths.js";
export {
  type AccountRoster,
  type RosterEntry,
  type RosterStorage,
  createAccountRoster,
} from "./roster.js";
export { type ActiveStore, resolveActiveStore } from "./active-store.js";
