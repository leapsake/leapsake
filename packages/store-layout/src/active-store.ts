import { LEGACY_STORE_PATH, OPEN_STORE_SLOT, storePath } from "./paths.js";
import type { RosterEntry } from "./roster.js";

/**
 * Which store this launch should open, and — the part that matters — **whether it
 * is encrypted**. This is the decision "encryption follows custody" turns on
 * (`model.md` §7.2): a client is either **Open** (no account, no keys anywhere, a
 * plaintext store) or **Protected** (an account exists, so every key exists).
 *
 * It is a pure function of facts gathered *before* anything is opened — the roster
 * (§7.4) and whether a pre-custody store is sitting there — because the boot path
 * has to know which mode to open in before it can read a single row.
 */
export type ActiveStore =
  | {
      /** No account exists: mint no keys, open the store plaintext. */
      custody: "open";
      /** Path relative to the app-data root. */
      path: string;
    }
  | {
      /** An account exists: every key exists and the store is encrypted. */
      custody: "protected";
      path: string;
      /** The account this store belongs to; absent for a legacy store. */
      accountId?: string;
    };

/**
 * Resolve the store to open.
 *
 * The three cases, in priority order:
 *
 * 1. **An account is in the roster** → Protected, at that account's own path.
 *    `activeAccountId` picks among several (the login picker's job); with none
 *    given the first account wins, which is the whole story while a client holds
 *    exactly one.
 * 2. **No account, but a pre-custody store exists** → Protected, at the legacy
 *    path. Builds before this change encrypted unconditionally, so that file's
 *    key is in the OS keychain and it must keep opening exactly as it did. It is
 *    deliberately *not* migrated into `stores/`: moving an encrypted file whose
 *    only key lives in a keychain is a data-loss risk taken for tidiness, and the
 *    path is derived here rather than hardcoded at the call site either way.
 * 3. **Neither** → Open. A genuinely fresh install: no keys, plaintext store.
 *
 * Note the roster wins over a legacy store. Once an account exists, the legacy
 * file is either already converted or is a leftover, and in both cases the
 * account's own store is the live one.
 */
export function resolveActiveStore(opts: {
  accounts: readonly RosterEntry[];
  /** Whether a pre-custody `leapsake.db` sits at the app-data root. */
  legacyStorePresent: boolean;
  /** Which account to open when the device holds more than one. */
  activeAccountId?: string;
}): ActiveStore {
  const { accounts, legacyStorePresent, activeAccountId } = opts;

  if (accounts.length > 0) {
    const account =
      accounts.find((a) => a.id === activeAccountId) ?? accounts[0];
    return {
      custody: "protected",
      path: storePath(account.id),
      accountId: account.id,
    };
  }

  if (legacyStorePresent) {
    return { custody: "protected", path: LEGACY_STORE_PATH };
  }

  return { custody: "open", path: storePath(OPEN_STORE_SLOT) };
}
