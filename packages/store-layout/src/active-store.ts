import { UNAUTHENTICATED_STORE_SLOT, storePath } from "./paths.js";
import type { RosterEntry } from "./roster.js";

/**
 * Which store this launch should open, and — the part that matters — **whether it
 * is encrypted**. This is the decision "encryption follows custody" turns on
 * (`model.md` §7.2): a client is either **Unauthenticated** (no account, no keys
 * anywhere, a plaintext store) or **Authenticated** (an account exists, so every
 * key exists).
 *
 * **`custody` names the file, not the account** — `"plaintext" | "encrypted"`,
 * deliberately not the state names above. The two agree today *because* encryption
 * follows custody, and they are spelled apart because `product-truths.md` delta 5
 * expects a user to opt out of encryption while holding an account. When that
 * lands, this discriminant is the one that changes and the state names do not. See
 * `AGENTS.md` → *Custody vocabulary*.
 *
 * It is a pure function of facts gathered *before* anything is opened — the roster
 * (§7.4) and whether a pre-custody store is sitting there — because the boot path
 * has to know which mode to open in before it can read a single row.
 */
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
      /** The account this store belongs to; absent for a legacy store. */
      accountId?: string;
    };

/**
 * Resolve the store to open. **The roster is the whole answer**: an account
 * exists, or it does not.
 *
 * - **An account is in the roster** → Authenticated, at that account's own path.
 *   `activeAccountId` picks among several (the login picker's job); with none
 *   given the first account wins, which is the whole story while a client holds
 *   exactly one.
 * - **No account** → Unauthenticated: no keys, a plaintext store.
 *
 * There is deliberately **no third case for a pre-custody store.** Builds before
 * the custody work encrypted unconditionally at a bare `leapsake.db`, and this
 * function briefly detected that file and kept opening it in place. That branch
 * was removed once it was settled that pre-v0.1 breaking changes are acceptable
 * (owner, 2026-07-27): it existed only to spare dev profiles a recreate, and it
 * cost a compatibility path in the most delicate code in the app — including a
 * mobile heuristic that had to infer "a store is encrypted" from the presence of
 * a key or a sidecar. **An install predating the custody work must be recreated.**
 */
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
