/**
 * Where this client keeps its stores, and which one to open.
 *
 * This package owns the on-device layout that "encryption follows custody"
 * (`plans/encryption/model.md` §7.2, §7.4) requires: the **account roster**, the
 * **per-account store paths**, and the pure decision of whether this launch is
 * **Open** (no account → no keys → plaintext) or **Protected** (an account → keys
 * → encrypted).
 *
 * It holds no filesystem and no crypto on purpose. Everything is either a pure
 * string derivation or logic over an injected storage port, so the same rules run
 * on desktop (a JSON file under `userData`), on mobile (no general filesystem
 * dependency), and in tests (a temp dir or an in-memory port).
 */
export { OPEN_STORE_SLOT, ROSTER_PATH, storeDir, storePath } from "./paths.js";
export {
  type AccountRoster,
  type RosterEntry,
  type RosterStorage,
  createAccountRoster,
} from "./roster.js";
export { type ActiveStore, resolveActiveStore } from "./active-store.js";
