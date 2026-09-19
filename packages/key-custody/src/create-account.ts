import {
  type KeyStore,
  encodeRecoveryPhrase,
  ensureDatabaseKey,
} from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import { sealPasswordDoor } from "./password-door.js";
import { type AccountBootstrap, enableSync } from "./session.js";

/**
 * Create an account on the plaintext store, the act that turns encryption on.
 * The caller then converts the store; the phrase is returned to show once.
 */
export async function createLocalAccount(opts: {
  keyStore: KeyStore;
  /** The open, still-plaintext store. Account rows are written into it. */
  driver: SqliteDriver;
  username: string;
  password: string;
  /** Recorded when the same act also binds a relay; the keys are the same. */
  relayUrl?: string;
  label?: string;
  platform?: string;
}): Promise<{
  accountId: string;
  /** The 24-word phrase, to show once. */
  recoveryPhrase: string;
  /** The at-rest key the caller must convert the store under. */
  dbKey: Uint8Array;
  /** The password-door sidecar, for the caller to write beside the converted
   *  store; without it only the recovery phrase reopens the store. */
  passwordSidecar: Uint8Array;
  /** What a relay needs if this account is being bound to one. */
  bootstrap: AccountBootstrap;
}> {
  const { keyStore, driver, username, password, relayUrl, label, platform } =
    opts;

  if (username.trim() === "") {
    throw new Error("A username is required to create an account.");
  }

  const { account, recoveryKey, bootstrap } = await enableSync({
    keyStore,
    driver,
    password,
    username,
    relayUrl,
    label,
    platform,
  });

  // Minted here, not at boot: this is the moment the store stops being
  // plaintext.
  const dbKey = await ensureDatabaseKey(keyStore);

  // Sealed here because this is the last moment the password is in hand; the
  // boot path seals the recovery door.
  const passwordSidecar = await sealPasswordDoor({
    keyStore,
    driver,
    password,
  });

  return {
    accountId: account.id,
    recoveryPhrase: encodeRecoveryPhrase(recoveryKey),
    dbKey,
    passwordSidecar,
    bootstrap,
  };
}
