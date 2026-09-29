import { UNAUTHENTICATED_STORE_SLOT, storePath } from "./paths.js";
import type { RosterEntry } from "./roster.js";

/** Which store this launch opens, and whether it is encrypted; `custody`
 *  names the file, not the account. */
export type ActiveStore =
  | {
      /** No account exists: mint no keys, open the store plaintext. */
      custody: "plaintext";
      /** Path relative to the app-data root. */
      path: string;
    }
  | {
      /** An account exists: every key exists and the store is encrypted. */
      custody: "encrypted";
      path: string;
      /** The account this store belongs to. */
      accountId?: string;
    };

/** The store to open, from the roster alone: an account's, the first unless
 *  `activeAccountId` picks, else the plaintext one. */
export function resolveActiveStore(opts: {
  accounts: readonly RosterEntry[];
  /** Which account to open when the device holds more than one. */
  activeAccountId?: string;
}): ActiveStore {
  const { accounts, activeAccountId } = opts;

  if (accounts.length === 0) {
    return {
      custody: "plaintext",
      path: storePath(UNAUTHENTICATED_STORE_SLOT),
    };
  }

  const account = accounts.find((a) => a.id === activeAccountId) ?? accounts[0];
  return {
    custody: "encrypted",
    path: storePath(account.id),
    accountId: account.id,
  };
}
