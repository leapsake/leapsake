import {
  type KeyStore,
  deriveRecoveryVerifier,
  readRecoveryKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type SqliteDriver,
  createAccountRepo,
  createKeyWrapRepo,
} from "@leapsake/data";
import {
  type AccountBootstrap,
  ensureDeviceMasterKey,
  normalizeUsername,
} from "./session.js";

/**
 * **Bind a relay to an account that already exists** (`model.md` §7.2, §7.5
 * Phase 1) — the act behind *"I made this account on one device, now I want it on
 * two."*
 *
 * `model.md` §7.2 has always said that local-only and synced users have identical
 * custody, so *"start syncing later adds a relay binding rather than a new
 * ritual"*. This is that binding, and until it existed the sentence was aspiration:
 * {@link enableSync} refuses a store that already holds an account and each
 * client's creation flow requires a *plaintext* store, so a local-only account's
 * only route to a relay was {@link joinAccount} — which joins somebody else's
 * account rather than publishing your own.
 *
 * ### Nothing is minted, and nothing is re-encrypted
 *
 * Every field the relay needs already exists in the store. {@link enableSync}
 * mints the KDF salt, the auth verifier and both master-key wrappings *"even
 * though no relay exists, so that binding one later adds no new ritual"* — this
 * function is the cash-in on that decision. It reads those rows, computes the two
 * escrow values that are pure functions of keys this device already holds, and
 * publishes. The master key, the password door and the recovery phrase are all
 * exactly what they were a moment before; a user who binds a relay does not have
 * to write down a new phrase, and no peer's ciphertext is affected.
 *
 * ### Publish before persisting
 *
 * The relay call comes **first**, and the local `bindRelay` write only happens if
 * it succeeded. That ordering is the whole point of this increment: the failure
 * this is built around is a **409, the username is taken**, and a user who hits it
 * must be left exactly as they were — still holding a working local-only account
 * they can retry under another handle. Persisting first would record a binding to
 * a relay that never accepted it, and the next sync would 401 forever with no way
 * back.
 *
 * There is no rollback path to write, because there is nothing to roll back: the
 * only local mutation is the last line.
 *
 * > **The reverse gap is closed by the relay, not here.** If the register
 * > succeeds and this process dies before the local write, the account is
 * > published but the store does not know it — and the retry re-registers the same
 * > account id, which the relay answers `"exists"` (idempotent on the id, keeping
 * > the first registration). So the retry falls through to the local write and
 * > converges. Do not "fix" that by checking registration first; the check and the
 * > act would race.
 *
 * ### What a 409 means, and why this does not resolve it
 *
 * A taken username has **two readings that want opposite outcomes** — *"that is my
 * own account from my other device"* (→ merge into it, `mergeAccountOnThisDevice`)
 * and *"that is a stranger, I need a different handle"* (→ call this again with
 * another username). Only the user can tell those apart, so this function refuses
 * to guess: it lets the relay's error through and the clients fork on it. See
 * `plans/v0-1_01_account-merge.md`, Increment 4.
 *
 * Calling again after a 409 **is** the rename. There is no separate rename
 * primitive because there is nothing to rename yet — the username has never been
 * published, so the second attempt is a first attempt with a different handle.
 * Renaming an *already bound* account is a different act (the relay's namespace
 * has to release the old handle) and is deliberately not built here: this refuses
 * a second binding outright.
 */
export async function bindRelayToAccount(opts: {
  keyStore: KeyStore;
  /** The open store, which must hold an account that is not yet relay-bound. */
  driver: SqliteDriver;
  /** The handle to claim on the relay. Normalized exactly as a login is. */
  username: string;
  relayUrl: string;
  /**
   * Publish the bootstrap (`registerAccountWithRelay`). Called **before** any
   * local write, so its failure — a taken username, an unreachable host — leaves
   * the account precisely as it was.
   */
  registerWithRelay: (bootstrap: AccountBootstrap) => Promise<void>;
}): Promise<{ accountId: string; username: string }> {
  const { keyStore, driver, relayUrl } = opts;

  const username = normalizeUsername(opts.username);
  if (username === "") {
    throw new Error("A username is required to start syncing.");
  }

  const accountRepo = createAccountRepo(driver);
  const account = await accountRepo.getSingleton();
  if (account === undefined) {
    throw new Error(
      "There is no account on this device to sync. Create one first.",
    );
  }
  if (account.relayUrl !== null) {
    throw new Error("This account is already syncing through a relay.");
  }

  // The account's master key, from this device's enclave wrapping. Not a mint:
  // `ensureDeviceMasterKey` only mints on a store with no account, and throws for
  // a device that holds one but has lost its enclave key — which is the right
  // refusal here too, since a Degraded device cannot vouch for the key it would
  // be publishing wrappings of.
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });

  // The two wrappings `enableSync` persisted at account creation. They *are* the
  // relay's copy — this publishes them rather than making new ones, which is why
  // binding changes nothing about how the account is opened.
  const keyWrapRepo = createKeyWrapRepo(driver);
  const passwordWrap = await keyWrapRepo.getActive({
    wrappedKind: "master",
    principalKind: "password",
  });
  if (passwordWrap === undefined) {
    throw new Error(
      "This account has no password door to publish, so no other device could " +
        "ever log in to it.",
    );
  }
  const recoveryWrap = await keyWrapRepo.getActive({
    wrappedKind: "master",
    principalKind: "recovery",
  });
  if (recoveryWrap === undefined) {
    throw new Error(
      "This account has no recovery escrow to publish. Replace your recovery " +
        "phrase from Settings, then try again.",
    );
  }

  // **Read, never mint** (the rule the boot path states for the same key). A
  // device that came back through a *password* door no longer holds the account's
  // recovery key — it stayed in the enclave that was wiped (§6) — and minting one
  // here would escrow a phrase nobody has written down, silently invalidating the
  // 24 words the user did write down. Rotation is the honest way back, and it is
  // reachable from Settings without a relay.
  const recoveryKey = await readRecoveryKey(keyStore);
  if (recoveryKey === undefined) {
    throw new Error(
      "This device no longer holds this account's recovery phrase, so it cannot " +
        "set up recovery for the account. Replace your recovery phrase from " +
        "Settings, then try again.",
    );
  }

  await opts.registerWithRelay({
    accountId: account.id,
    username,
    kdfSalt: account.kdfSalt,
    authVerifier: account.authVerifier,
    wrappedMasterKey: passwordWrap.ciphertext,
    wrappedMasterKeyRecovery: recoveryWrap.ciphertext,
    // The two escrow values that are not rows: both are pure functions of keys
    // this device already holds, computed here exactly as `enableSync` computes
    // them, so a bound-later account is indistinguishable on the relay from one
    // that was bound at creation.
    wrappedRecoveryKey: wrapKey(recoveryKey, masterKey),
    recoveryVerifier: deriveRecoveryVerifier(recoveryKey),
  });

  // The only local mutation, and it happens only on success.
  await accountRepo.bindRelay({ username, relayUrl });

  return { accountId: account.id, username };
}
