import {
  type KeyStore,
  encodeRecoveryPhrase,
  ensureDatabaseKey,
} from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import { type AccountBootstrap, enableSync } from "./session.js";

/**
 * **Custody Phase 0.5 — creating an account** (`model.md` §7.2.1): the single act
 * that turns encryption on. Everything here is local; no relay is involved and
 * nothing leaves the device.
 *
 * This is the *key* half of the flow. It runs against the still-open **Open**
 * (plaintext) store and leaves it holding the account, device, and key-wrap rows —
 * which the caller then carries into an encrypted store by converting it (§8.1).
 * That ordering is deliberate: the conversion copies whatever is in the store, so
 * the account rows must exist *before* it runs.
 *
 * The caller owns the irreversible half — convert the store, write the roster
 * entry, destroy the plaintext original — because those are filesystem-shaped and
 * differ per platform. See each client's account-creation flow.
 *
 * ### What gets minted
 *
 * `enableSync` already mints and persists the master key, the KDF salt, the
 * password KEK's `wrap(MK, KEK)`, the recovery key with its `wrap(MK, RK)`, and
 * the auth verifier — the verifier now even though no relay exists, so that
 * binding one later adds no new ritual (§7.5 Phase 1). What it does *not* mint is
 * the **db-key**, because until this change that key was minted at first launch;
 * under *encryption follows custody* nothing mints it until here.
 *
 * ### The recovery phrase
 *
 * Returned so the caller can show it **exactly once**, framed as the
 * *forgot-password* backstop (§7.2.1). It is not a second copy of the data and
 * must not be sold as one: an account protects **access**, not against a dead
 * SSD. The phrase can be revealed again later from Settings, so this is a
 * convenience, not the only chance.
 */
export async function createLocalAccount(opts: {
  keyStore: KeyStore;
  /** The open, still-plaintext store. Account rows are written into it. */
  driver: SqliteDriver;
  username: string;
  password: string;
  /**
   * Recorded on the account when the same act also binds a relay. The account
   * itself is local either way — binding only publishes what already exists
   * (§7.5 Phase 1) — so this changes nothing about the keys minted here.
   */
  relayUrl?: string;
  label?: string;
  platform?: string;
}): Promise<{
  accountId: string;
  /** The 24-word phrase, to show once. */
  recoveryPhrase: string;
  /** The at-rest key the caller must convert the store under. */
  dbKey: Uint8Array;
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

  // Minted here, not at boot: this is the moment the store stops being plaintext.
  const dbKey = await ensureDatabaseKey(keyStore);

  return {
    accountId: account.id,
    recoveryPhrase: encodeRecoveryPhrase(recoveryKey),
    dbKey,
    bootstrap,
  };
}
