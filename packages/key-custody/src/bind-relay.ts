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
 * Publish an existing local account to a relay, minting and re-encrypting
 * nothing. Publishes before it persists; a 409 passes through for the clients.
 */
export async function bindRelayToAccount(opts: {
  keyStore: KeyStore;
  /** The open store, which must hold an account that is not yet relay-bound. */
  driver: SqliteDriver;
  /** The handle to claim on the relay. Normalized exactly as a login is. */
  username: string;
  relayUrl: string;
  /** Publish the bootstrap. Called before any local write, so a failure leaves
   *  the account as it was. */
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

  // Throws on a Degraded device, which cannot vouch for the key it would
  // publish.
  const { masterKey } = await ensureDeviceMasterKey({ keyStore, driver });

  // The wraps account creation persisted are the relay's copy.
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

  // Read, never mint: a new key would escrow a phrase nobody wrote down.
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
    // Computed exactly as `enableSync` does, so a later binding looks the same.
    wrappedRecoveryKey: wrapKey(recoveryKey, masterKey),
    recoveryVerifier: deriveRecoveryVerifier(recoveryKey),
  });

  // The only local mutation, and it happens only on success.
  await accountRepo.bindRelay({ username, relayUrl });

  return { accountId: account.id, username };
}
