import {
  ALG,
  DATABASE_KEY,
  KDF_ALG,
  type KeyStore,
  RECOVERY_KEY,
  deriveKeyMaterial,
  deriveRecoveryVerifier,
  ensureRecoveryKey,
  equalBytes,
  generateKey,
  generateSalt,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import { bytesToUtf8, utf8ToBytes } from "@leapsake/bytes";
import type { Account } from "@leapsake/schema";
import {
  type SqliteDriver,
  createAccountRepo,
  createDeviceRepo,
  createKeyWrapRepo,
} from "@leapsake/data";

/**
 * The unlocked key material for the running device: a stable device identifier
 * and the in-memory master key (MK). Held by a client after bootstrap so later
 * work (per-item content keys, sync) can wrap/unwrap under MK. The MK bytes live
 * only here in memory — on disk it exists solely as its enclave wrapping.
 *
 * **Accepted limit: MK is a plaintext `Uint8Array` for the process lifetime and
 * is never zeroized.** In a GC'd runtime it cannot reliably be — V8 and Hermes
 * both copy and intern buffers — so `.fill(0)` would buy the appearance of
 * hygiene rather than the fact. What follows: this is exposed to a memory dump,
 * swap, or a crash report on an *already compromised* device, and at-rest
 * encryption rather than wiping is the real device-theft mitigation. Two
 * consequences for anyone editing this file: never let a key-bearing object
 * reach a log or a crash reporter, and do wipe the short-lived **KEK** and
 * transient wrap keys after use, since those are derived-then-used-once and
 * cost nothing to clear.
 */
export interface KeySession {
  deviceId: string;
  masterKey: Uint8Array;
}

/**
 * The minimum length of an account password, and the one place it is defined.
 *
 * Deliberately higher than a typical login floor: this password derives the KEK
 * that protects the master key **and**, through {@link sealPasswordDoor}, the
 * at-rest db-key — in a zero-knowledge design with no server-side reset, so an
 * offline guess against a weak one is the whole attack. It lives here because
 * this file holds every path that consumes a password (create, recover,
 * re-authenticate, unlock), and it is re-exported through `@leapsake/core` so
 * both clients check the same number instead of keeping four copies in step.
 */
export const MIN_PASSWORD_LENGTH = 12;

/** KeyStore id holding this device's stable UUID (UTF-8 bytes). */
const DEVICE_ID_KEY = "device-id";
/** KeyStore id holding this device's 32-byte enclave secret. */
const ENCLAVE_KEY = "enclave";

/**
 * Every KeyStore id this app writes — the complete set of on-device secrets. It
 * exists as one exported list so a **factory reset** can clear them all without
 * knowing where each id is defined (the mobile {@link KeyStore} has no bulk clear,
 * only per-id `deleteSecret`). Keep this in step with every `keyStore.setSecret`
 * call across the packages: `db-key`/`recovery-key` (the at-rest + recovery keys
 * from `@leapsake/crypto`) and this file's `device-id`/`enclave`.
 */
export const KEYSTORE_SECRET_IDS = [
  DATABASE_KEY,
  RECOVERY_KEY,
  DEVICE_ID_KEY,
  ENCLAVE_KEY,
] as const;

/**
 * This device's identity in the keychain: a stable id and the enclave secret that
 * wraps the master key under it. Minted on first read, returned unchanged after.
 *
 * Split out from {@link ensureDeviceMasterKey} because the two halves have very
 * different reach. This half touches only the keychain and is therefore safe to
 * call from a path that is *repairing* the `key_wrap` rows; the master-key half
 * writes one, and on a device that lost its keychain that write is the bug slice 9
 * exists to prevent (see {@link adoptAccountMasterKey}).
 *
 * Mint-if-missing is load-bearing for the repair, not just convenience: a wiped
 * keychain has no enclave secret at all, so a `getSecret`-and-throw would refuse to
 * repair exactly the device that needs it.
 *
 * Private on purpose — it hands back the raw enclave secret, which nothing outside
 * this file has a reason to hold.
 */
async function ensureDeviceIdentity(
  keyStore: KeyStore,
): Promise<{ deviceId: string; enclaveKey: Uint8Array }> {
  // Stable device id — minted once, then read back each launch.
  let deviceId: string;
  const storedDeviceId = await keyStore.getSecret(DEVICE_ID_KEY);
  if (storedDeviceId === undefined) {
    deviceId = crypto.randomUUID();
    await keyStore.setSecret(DEVICE_ID_KEY, utf8ToBytes(deviceId));
  } else {
    deviceId = bytesToUtf8(storedDeviceId);
  }

  // Device enclave secret — the local unlock path for MK, held off-DB.
  let enclaveKey = await keyStore.getSecret(ENCLAVE_KEY);
  if (enclaveKey === undefined) {
    enclaveKey = generateKey();
    await keyStore.setSecret(ENCLAVE_KEY, enclaveKey);
  }

  return { deviceId, enclaveKey };
}

/**
 * Bind `masterKey` to this device's enclave, replacing whatever was bound before:
 * the one place a `(master, enclave, <device>)` wrap is established.
 *
 * Used by every path that brings an *account's* master key onto a device — joining,
 * recovering, and repairing a device that came back through a door
 * ({@link adoptAccountMasterKey}). Returns `"unchanged"` when the enclave already
 * holds this key, which is the ordinary case rather than the exception: a plain
 * sign-out keeps the device id and enclave secret, so the unlock gate is re-entered
 * on every re-login and a blind re-wrap would churn a fresh row each time.
 *
 * Revoke strictly precedes add — `key_wrap_active` is a partial unique index over
 * the live rows, so adding first collides. The pair is transactional because a
 * crash between them would leave the device with no enclave door at all, openable
 * only by password or phrase.
 */
async function adoptMasterKeyIntoEnclave(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): Promise<{ deviceId: string; status: "adopted" | "unchanged" }> {
  const { keyStore, driver, masterKey } = opts;
  const { deviceId, enclaveKey } = await ensureDeviceIdentity(keyStore);
  const keyWrapRepo = createKeyWrapRepo(driver);

  const existing = await keyWrapRepo.getActive({
    wrappedKind: "master",
    principalKind: "enclave",
    principalRef: deviceId,
  });
  if (existing !== undefined) {
    try {
      if (equalBytes(unwrapKey(existing.ciphertext, enclaveKey), masterKey)) {
        return { deviceId, status: "unchanged" };
      }
    } catch {
      // A row that will not open under the current enclave secret is stale, not
      // an error: the keychain was replaced under it. Fall through and re-wrap.
    }
  }

  await driver.transaction(async () => {
    if (existing !== undefined) await keyWrapRepo.revoke(existing.id);
    await keyWrapRepo.add({
      wrappedKind: "master",
      principalKind: "enclave",
      principalRef: deviceId,
      ciphertext: wrapKey(masterKey, enclaveKey),
      alg: ALG,
    });
  });
  return { deviceId, status: "adopted" };
}

/**
 * Custody Phase 0 (README.md): make the device's master
 * key real on first launch and recover it on every launch after — the first
 * consumer of the OS {@link KeyStore}.
 *
 * On first run it mints a device id + enclave secret (stored in the OS keychain,
 * outside the synced DB) and a random MK, persisting MK only as a `key_wrap`
 * row — `wrap(MK, enclave)` keyed by the device id (`wrapped_kind = 'master'`,
 * `principal_kind = 'enclave'`). On later runs it reads the enclave secret back
 * and unwraps the existing row. Idempotent: calling it every launch adds no
 * extra rows.
 *
 * This is AEAD-only (no passphrase/KDF, no asymmetric keys) — the symmetric
 * Stage-1 floor. The passphrase/recovery unlock doors are added later as
 * additional wrappings of the same MK, re-encrypting nothing.
 *
 * Takes a {@link SqliteDriver} (like `createCore`) so a client wires it with one
 * call between `runMigrations` and `createCore`; run migrations first.
 *
 * ### It refuses to mint once an account exists
 *
 * Minting is only ever correct on a store that has no account yet. A store that
 * *does* have one already has a master key — the account's — reachable from the
 * password and recovery `key_wrap` rows; minting a second one there means this
 * device silently stops speaking the account's language, sealing records no peer
 * can open and discarding theirs. That is not hypothetical: it is what an OS
 * keychain loss used to do here, because a wiped keychain takes `device-id` with
 * it and a fresh id matches no row (custody slice 9).
 *
 * So this throws instead, and the boot path repairs the device first — see
 * {@link adoptAccountMasterKey}, which every door unlock now runs before reaching
 * this function. The paths that legitimately establish an account
 * ({@link enableSync}, {@link joinAccount}, {@link recoverAccount}) go through
 * {@link adoptMasterKeyIntoEnclave} rather than here, so none of them trips it.
 */
export async function ensureDeviceMasterKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
}): Promise<KeySession> {
  const { keyStore, driver } = opts;
  const keyWrapRepo = createKeyWrapRepo(driver);
  const { deviceId, enclaveKey } = await ensureDeviceIdentity(keyStore);

  // The master key — minted on first run, recovered after. The DB only ever
  // holds wrap(MK, enclave), never MK itself.
  const existing = await keyWrapRepo.getActive({
    wrappedKind: "master",
    principalKind: "enclave",
    principalRef: deviceId,
  });
  if (existing !== undefined) {
    return { deviceId, masterKey: unwrapKey(existing.ciphertext, enclaveKey) };
  }

  if ((await createAccountRepo(driver).getSingleton()) !== undefined) {
    throw new Error(
      "This device holds an account but no enclave key for it. Its master key " +
        "must be re-adopted from an unlock door before the store can be used.",
    );
  }

  const masterKey = generateKey();
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "enclave",
    principalRef: deviceId,
    ciphertext: wrapKey(masterKey, enclaveKey),
    alg: ALG,
  });
  return { deviceId, masterKey };
}

/**
 * Whether this store holds an account (custody Phase 1), for a client to branch
 * its onboarding UI: invite the user to create one, or show the account they
 * have. Carries only non-secret identity (the account id + when it was created)
 * — never key material.
 *
 * **`hasAccount`, not `enabled`.** The field was named for sync and meant custody,
 * which read as "does this store sync" — false for the local-only account that
 * `relayUrl` actually answers for. Renamed 2026-07-31; see `AGENTS.md` →
 * *Custody vocabulary*.
 */
export interface SyncStatus {
  hasAccount: boolean;
  accountId?: string;
  createdAt?: number;
  username?: string;
  relayUrl?: string;
}

/**
 * Read whether sync has been enabled on this store. A thin read over the account
 * singleton ({@link enableSync} creates exactly one), so a client need not reach
 * into `@leapsake/data` for the account repo.
 */
export async function getSyncStatus(opts: {
  driver: SqliteDriver;
}): Promise<SyncStatus> {
  const account = await createAccountRepo(opts.driver).getSingleton();
  if (account === undefined) return { hasAccount: false };
  return {
    hasAccount: true,
    accountId: account.id,
    createdAt: account.createdAt,
    username: account.username ?? undefined,
    relayUrl: account.relayUrl ?? undefined,
  };
}

/**
 * **The account-creation rollback**: undo the account rows this device just
 * wrote, when the step *after* them fails. Remove the account identity (account +
 * device rows) and revoke the **password** and **recovery** wrappings of the
 * master key, leaving the enclave wrapping — and all data — untouched, so the
 * device is exactly as it was a moment earlier.
 *
 * Its first caller in each client is the relay-registration failure path of
 * account creation (a taken username, an unreachable relay). That call happens
 * *before* anything on disk moves: the store is still the plaintext Unauthenticated one and
 * no roster entry exists yet, so undoing the rows genuinely restores the prior
 * state. A no-op (does not throw) if no account is set up.
 *
 * Its second is the **merge flow** (`apps/desktop/src/main/db/merge-account-flow.ts`),
 * which needs the account row gone because {@link joinAccount} refuses to run
 * while one exists. That is a different use — clearing to make room rather than
 * to undo — and it does *not* reopen the hole the warning below describes: the
 * merge calls this against a **copy** that no roster entry names, and the copy
 * gains the synced account's row moments later, before any entry points at it.
 * The "rows cleared, roster not" state is therefore never on disk, in either
 * store, for any length of time, and the live store is not mutated at all.
 *
 * > **Not a user-facing action, and no longer reachable as one.** This used to
 * > back a "Disconnect account from this device" button, which the custody
 * > rebuild made incoherent: it cleared these rows but never the **roster**, and
 * > the roster is what decides whether a store is encrypted (§7.4). A device
 * > that pressed it stayed Authenticated on disk while reporting no account —
 * > hiding Sign out and Forget account, offering "create an account" instead,
 * > and failing that too, since creation requires a plaintext Unauthenticated store. The
 * > button was removed rather than repaired: "stop syncing but keep the data"
 * > is a narrow want, and rebuilding it properly means deciding what the relay
 * > does with the account, not just what this row does *(owner, 2026-07-28)*.
 *
 * Local only: it never contacts a relay, so an account already registered
 * elsewhere keeps existing there. Re-keying/forgetting on the relay is a future
 * concern.
 */
export async function clearLocalAccount(opts: {
  driver: SqliteDriver;
}): Promise<void> {
  const { driver } = opts;
  const accountRepo = createAccountRepo(driver);
  if ((await accountRepo.getSingleton()) === undefined) return;

  await driver.transaction(async () => {
    const keyWrapRepo = createKeyWrapRepo(driver);
    for (const door of ["password", "recovery"] as const) {
      const wrap = await keyWrapRepo.getActive({
        wrappedKind: "master",
        principalKind: door,
      });
      if (wrap !== undefined) await keyWrapRepo.revoke(wrap.id);
    }
    await createDeviceRepo(driver).clear();
    await accountRepo.clear();
  });
}

/**
 * The master key unwrapped by a non-enclave door (password or recovery key). It
 * is intentionally *not* a {@link KeySession}: unlocking by password yields the
 * account's master key without any device involvement, so binding it to a
 * device (a fresh enclave wrapping, the §6 unlock cache) is the separate Phase-2
 * adoption step — it needs that device's {@link KeyStore} and ships with the
 * second-device / relay wiring.
 */
export interface UnlockedMasterKey {
  accountId: string;
  masterKey: Uint8Array;
}

/**
 * Everything the relay needs to let a *second* device join this account by
 * username + password. {@link enableSync} returns it so
 * the caller can hand it to `HttpSyncTransport.register`. It is all
 * public-or-blind: the `authVerifier` authenticates login without revealing the
 * KEK (model.md §9.3), and `wrappedMasterKey` = `wrap(MK, password-KEK)` is
 * ciphertext the relay stores but can never read (the "protected symmetric key").
 */
export interface AccountBootstrap {
  accountId: string;
  /** The chosen login handle, or `null` if the account is not yet relay-bound. */
  username: string | null;
  kdfSalt: Uint8Array;
  authVerifier: Uint8Array;
  wrappedMasterKey: Uint8Array;
  /**
   * Ciphertext `wrap(recoveryKey, MK)` — lets a password-joining device recover
   * the account recovery key from MK alone, so every device shows one phrase. The
   * inverse of {@link wrappedMasterKeyRecovery}: escrowed on the relay and handed
   * back over the already-authenticated bootstrap channel, where a joining device
   * holds MK (just unwrapped it) but never had the recovery phrase.
   */
  wrappedRecoveryKey: Uint8Array;
  /**
   * Ciphertext `wrap(MK, recoveryKey)` — the recovery escrow. Escrowed on the
   * relay (alongside the password wrap) so a device that lost its password can
   * recover the master key from the recovery phrase alone (`model.md` §6).
   */
  wrappedMasterKeyRecovery: Uint8Array;
  /**
   * The recovery auth verifier ({@link deriveRecoveryVerifier}); the relay stores
   * only its hash, so it can authenticate a recovery without learning the key.
   */
  recoveryVerifier: Uint8Array;
}

/**
 * Normalize a username to its canonical form (matches the relay's normalization).
 *
 * Package-internal rather than private: {@link bindRelayToAccount} claims a handle
 * on the relay from a *different* file, and a second copy of this rule is how the
 * client and the relay end up disagreeing about which names collide.
 */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * The relay's account-bootstrap channel, as {@link joinAccount} needs it — the
 * minimal slice of `HttpSyncTransport` that the join uses (a real transport
 * satisfies it structurally). It is *not* part of the `SyncTransport` port: these
 * are account-adoption concerns, not the per-record sync the engine drives.
 */
export interface AccountBootstrapChannel {
  /** Prelogin: resolve a username → account id + public salt (unauthed). */
  lookup(username: string): Promise<{ accountId: string; kdfSalt: Uint8Array }>;
  /**
   * Bearer-authed (with the derived creds): fetch `wrap(MK, KEK)` ciphertext, plus
   * the optional `wrap(recoveryKey, MK)` escrow a joining device adopts so it
   * reveals the account phrase (`wrappedRecoveryKey` absent from a pre-change relay).
   */
  fetchBootstrap(creds: {
    accountId: string;
    authVerifier: Uint8Array;
  }): Promise<{
    wrappedMasterKey: Uint8Array;
    wrappedRecoveryKey?: Uint8Array;
  }>;
}

/**
 * The relay channel {@link recoverAccount} needs — the recovery siblings of the
 * bootstrap channel. `fetchRecovery` proves possession of the recovery key (its
 * verifier) to fetch `wrap(MK, recoveryKey)`; `resetCredentials` replaces the
 * account's password door under the same proof, so a recovered device can sync.
 */
export interface RecoveryChannel {
  lookup(username: string): Promise<{ accountId: string; kdfSalt: Uint8Array }>;
  fetchRecovery(creds: {
    accountId: string;
    recoveryVerifier: Uint8Array;
  }): Promise<Uint8Array>;
  resetCredentials(args: {
    accountId: string;
    recoveryVerifier: Uint8Array;
    authVerifier: Uint8Array;
    kdfSalt: Uint8Array;
    wrappedMasterKey: Uint8Array;
  }): Promise<void>;
}

/**
 * Custody Phase 1 (README.md): **enable sync** — promote a
 * single, enclave-only device to an account with a portable **password** unlock
 * door, plus a one-time **recovery key**. This is the first crypto that leaves
 * AEAD-only territory: it derives a KEK with Argon2id (@leapsake/crypto).
 *
 * The KEK layer (`model.md` §4) is the whole point: the master key is unchanged
 * and **nothing is re-encrypted** — we only add two *new wrappings* of the same
 * MK (one under the Argon2id KEK, one under the recovery key) alongside the
 * existing enclave wrapping. The server-stored `auth_verifier` is a separate
 * HKDF branch of the password seed, so it authenticates login while revealing
 * nothing about the KEK (`model.md` §9.3).
 *
 * Takes an optional unique `username` (and the `relayUrl` this account will sync
 * through) so a second device can later log in: both are persisted on the
 * account row, and the returned {@link AccountBootstrap} carries what the relay
 * must hold for that login (`HttpSyncTransport.register`). They are optional
 * because a device can establish an account *locally* before any relay is
 * chosen; a username is required only to actually register with a relay (the
 * apps collect it when they wire sync).
 *
 * Returns the created {@link Account}, the recovery key to show the user
 * **once** (the caller/UI owns display + encoding; we never store it), and the
 * bootstrap (its `username` is `null` until one is chosen). Refuses if sync is
 * already enabled — the recovery key cannot be re-derived, so re-enabling must
 * be an explicit reset, not a silent overwrite.
 */
export async function enableSync(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  username?: string;
  relayUrl?: string;
  label?: string;
  platform?: string;
}): Promise<{
  account: Account;
  recoveryKey: Uint8Array;
  bootstrap: AccountBootstrap;
}> {
  const { keyStore, driver, password, relayUrl, label, platform } = opts;
  const username =
    opts.username !== undefined ? normalizeUsername(opts.username) : null;
  const accountRepo = createAccountRepo(driver);

  if ((await accountRepo.getSingleton()) !== undefined) {
    throw new Error("Sync is already enabled for this store.");
  }

  // The enclave-unlocked MK is what the new doors will wrap (idempotent).
  const { deviceId, masterKey } = await ensureDeviceMasterKey({
    keyStore,
    driver,
  });

  const salt = generateSalt();
  const { kek, authVerifier } = deriveKeyMaterial(password, salt);
  // Reuse this device's enclave recovery key (minted at first launch, and already
  // wrapping the at-rest db-key) rather than minting a fresh one, so a single
  // recovery phrase opens both the local file and — via the escrow below — the
  // account (`model.md` §6). Idempotent: it's the same key shown in Settings.
  const recoveryKey = await ensureRecoveryKey(keyStore);
  const recoveryVerifier = deriveRecoveryVerifier(recoveryKey);
  // The protected symmetric key: wrap(MK, password-KEK). Persisted locally as the
  // `password` door *and* handed to the relay so a second device can recover MK.
  const wrappedMasterKey = wrapKey(masterKey, kek);
  // The recovery escrow: wrap(MK, recoveryKey). Stored locally as the `recovery`
  // door *and* handed to the relay, so a device that forgot its password can
  // recover MK from the phrase alone.
  const wrappedMasterKeyRecovery = wrapKey(masterKey, recoveryKey);
  // The inverse escrow: wrap(recoveryKey, MK). Handed to the relay so a
  // password-joining device — which holds MK but never had the phrase — can
  // recover the *account* recovery key and reveal the same phrase (one account,
  // one phrase). A circular wrap of two independent random keys; leaks nothing new
  // (MK compromise is already total).
  const wrappedRecoveryKey = wrapKey(recoveryKey, masterKey);

  const account = await accountRepo.create({
    kdfSalt: salt,
    authVerifier,
    kdfAlg: KDF_ALG,
    username,
    relayUrl: relayUrl ?? null,
  });
  await createDeviceRepo(driver).register({
    id: deviceId,
    accountId: account.id,
    label: label ?? null,
    platform: platform ?? null,
  });

  const keyWrapRepo = createKeyWrapRepo(driver);
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "password",
    ciphertext: wrappedMasterKey,
    alg: ALG,
  });
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "recovery",
    ciphertext: wrappedMasterKeyRecovery,
    alg: ALG,
  });

  return {
    account,
    recoveryKey,
    bootstrap: {
      accountId: account.id,
      username,
      kdfSalt: salt,
      authVerifier,
      wrappedMasterKey,
      wrappedRecoveryKey,
      wrappedMasterKeyRecovery,
      recoveryVerifier,
    },
  };
}

/**
 * Custody Phase 2 / login (README.md): unlock the account's
 * master key from the **password** alone — no enclave, no device secret. This is
 * exactly what a second device does after the account's ciphertext arrives over
 * the relay: derive the KEK from the password + the public salt, authenticate
 * with the verifier, then unwrap `wrap(MK, KEK)`.
 *
 * Throws on an incorrect password (the verifier mismatch is caught **before** any
 * unwrap is attempted) and if sync has not been enabled.
 */
export async function unlockWithPassword(opts: {
  driver: SqliteDriver;
  password: string;
}): Promise<UnlockedMasterKey> {
  const { driver, password } = opts;
  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  if (account.kdfAlg !== KDF_ALG) {
    throw new Error(`Unsupported key-derivation algorithm: ${account.kdfAlg}`);
  }

  const { kek, authVerifier } = deriveKeyMaterial(password, account.kdfSalt);
  // Constant-time check before touching any wrapped key, so a wrong password is
  // an authentication failure, not a decrypt failure.
  if (!equalBytes(authVerifier, account.authVerifier)) {
    throw new Error("Incorrect password.");
  }

  return {
    accountId: account.id,
    masterKey: await unwrapMasterKeyUnder(driver, "password", kek),
  };
}

/**
 * The recovery sibling of {@link unlockWithPassword}: unwrap the master key from
 * the one-time recovery key shown at sync-enable (`model.md` §6). No verifier —
 * the recovery key is high-entropy, so a wrong key simply fails the AEAD unwrap.
 */
export async function unlockWithRecoveryKey(opts: {
  driver: SqliteDriver;
  recoveryKey: Uint8Array;
}): Promise<UnlockedMasterKey> {
  const { driver, recoveryKey } = opts;
  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  return {
    accountId: account.id,
    masterKey: await unwrapMasterKeyUnder(driver, "recovery", recoveryKey),
  };
}

/**
 * Which door a boot came through, carrying the key material that door already
 * derived — never the password itself.
 *
 * The password sidecar is sealed under the *account's* salt, so opening it yields
 * the very KEK that wraps the master key: the boot path has already done the one
 * expensive derivation and {@link adoptAccountMasterKey} needs no second. That is
 * what makes the repair affordable on mobile, where an Argon2id pass on unJITted
 * Hermes runs for minutes. It also keeps the typed password inside the unlock loop
 * — everything downstream handles 32-byte keys.
 */
export type AdoptionDoor =
  | { kind: "password"; kek: Uint8Array; authVerifier: Uint8Array }
  | { kind: "recovery"; recoveryKey: Uint8Array };

/**
 * Custody slice 9: after a boot has come through a password or recovery door,
 * make sure this device's enclave holds **the account's** master key.
 *
 * ### The problem it fixes
 *
 * A door unlock is, by construction, what happens when the OS keychain no longer
 * opens the store — an OS reinstall, a new machine, or a signing-identity change
 * (this package's README → *The signing identity owns the enclave key*). The door recovers the *db-key*, so the store opens and
 * the user is back in. But the same wipe took `device-id` and `enclave`, so
 * {@link ensureDeviceMasterKey} would find no wrap row for the fresh id and mint a
 * brand-new master key. The device would then hold a key the account has never
 * seen: it seals records no peer can open, and the sync engine skips peers' records
 * it cannot decrypt *while advancing the cursor past them*, so both directions lose
 * data permanently and silently.
 *
 * This reads the account's real master key back out of the door that was just
 * opened and binds it to the new enclave, so `ensureDeviceMasterKey` — called
 * immediately after — finds it and mints nothing.
 *
 * ### Why it is safe
 *
 * Nothing at rest is sealed under MK. Migration 27 retired the last content-key
 * consumer, so MK appears only in `key_wrap` rows and in the sync envelope. The
 * repair therefore cannot corrupt anything on disk: worst case it rewrites one row
 * to the value it already had.
 *
 * ### Where it must run
 *
 * Between `runMigrations` and {@link ensureDeviceMasterKey}, synchronously. Not
 * earlier: there is no driver until the store is open. Not later, and not in the
 * background: the launch-time recovery-escrow catch-up publishes
 * `wrap(recoveryKey, MK)` **to the relay**, so a stray key reaching it makes one
 * device's local problem account-wide.
 *
 * Returns `"unchanged"` on the ordinary case — a plain sign-out keeps the device
 * identity, so most door unlocks have nothing to repair. `"adopted"` means the
 * device really had drifted, and the caller should also reset its sync watermarks
 * (`resyncAfterMasterKeyRepair`) to re-push and re-pull what drifted apart.
 *
 * Throws rather than degrading: a device that cannot prove which master key is the
 * account's has no business opening the store and syncing from it.
 */
export async function adoptAccountMasterKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  door: AdoptionDoor;
  platform?: string;
}): Promise<"adopted" | "unchanged"> {
  const { keyStore, driver, door, platform } = opts;

  const account = await createAccountRepo(driver).getSingleton();
  if (account === undefined) {
    throw new Error("There is no account on this device to adopt a key for.");
  }

  let masterKey: Uint8Array;
  if (door.kind === "password") {
    // The sidecar carries the salt it was sealed under, so a verifier that does
    // not match the account row means the two have drifted — a sidecar left by a
    // crash mid password-change. Its KEK cannot open the password wrap either, so
    // refuse here with something a reader can act on rather than one line later
    // with an opaque AEAD failure. The phrase door is the way in: it derives from
    // the recovery key, not the password salt, so it is unaffected.
    if (!equalBytes(door.authVerifier, Uint8Array.from(account.authVerifier))) {
      throw new Error(
        "This store's password door is out of step with its account. Unlock " +
          "with the recovery phrase instead.",
      );
    }
    masterKey = await unwrapMasterKeyUnder(driver, "password", door.kek);
  } else {
    masterKey = await unwrapMasterKeyUnder(
      driver,
      "recovery",
      door.recoveryKey,
    );
  }

  const { deviceId, status } = await adoptMasterKeyIntoEnclave({
    keyStore,
    driver,
    masterKey,
  });
  if (status === "adopted") {
    // A repaired device is a new device id on the account, so register it.
    //
    // Two rows from before the wipe are left behind on purpose: the old `device`
    // registration, which nothing can tell apart from a real second device, and
    // the old enclave `key_wrap`, which is keyed to a device id that will never be
    // presented again and whose enclave secret died with the keychain. Both are
    // unopenable and unmatchable rather than merely unused, and sweeping them is
    // per-device revocation — post-launch work with a real design behind it.
    await createDeviceRepo(driver).register({
      id: deviceId,
      accountId: account.id,
      platform: platform ?? null,
    });
  }
  return status;
}

/**
 * Custody Phase 2 / multi-device login (README.md): join
 * an **existing** account on a fresh device, so it converges over the relay. This
 * is the one capability that completes Stage-1 sync — `account`/`key_wrap` are
 * device-local and never replicate, so a second device needs this separate
 * account-bootstrap channel to obtain the master key.
 *
 * Given the relay's bootstrap channel (an {@link HttpSyncTransport} built with no
 * credentials — the joining device has none yet), it: looks the account up by
 * username (prelogin → account id + public salt); derives the KEK + verifier from
 * the password; authenticates with the verifier and fetches `wrap(MK, KEK)`;
 * unwraps MK locally; persists the local `account` row **under the looked-up id**
 * (the relay namespace, shared across devices); and **adopts MK under this
 * device's enclave** (replacing the throwaway first-launch wrap) so MK survives a
 * restart without a re-login. A wrong password fails at the relay's verifier
 * check (401), before any unwrap.
 *
 * Returns the unlocked {@link KeySession} for the caller to rebuild `core` with.
 * Refuses if this device is already part of an account — joining is for a fresh
 * device; reconciling pre-existing local data is a documented future phase
 * (overwrite is the accepted first-cut stance).
 */
export async function joinAccount(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  transport: AccountBootstrapChannel;
  relayUrl: string;
  username: string;
  password: string;
  label?: string;
  platform?: string;
}): Promise<KeySession> {
  const { keyStore, driver, transport, relayUrl, password, label, platform } =
    opts;
  const username = normalizeUsername(opts.username);
  const accountRepo = createAccountRepo(driver);

  if ((await accountRepo.getSingleton()) !== undefined) {
    throw new Error("This device is already part of an account.");
  }

  // 1. Prelogin → account id + public salt (unauthed). Copy the salt into a
  //    fresh array so it is ArrayBuffer-backed for the account-row write.
  const lookup = await transport.lookup(username);
  const { accountId } = lookup;
  const kdfSalt = Uint8Array.from(lookup.kdfSalt);

  // 2. Derive the KEK + verifier from the password and the public salt.
  const { kek, authVerifier } = deriveKeyMaterial(password, kdfSalt);

  // 3. Authenticate with the verifier and fetch wrap(MK, KEK), then unwrap MK
  //    locally. A wrong password → wrong verifier → 401 here, before any unwrap.
  const bootstrap = await transport.fetchBootstrap({
    accountId,
    authVerifier,
  });
  const masterKey = unwrapKey(bootstrap.wrappedMasterKey, kek);

  // 4. Persist the local account row under the looked-up id, so this device
  //    pushes/pulls into the same relay namespace as device 1.
  await accountRepo.create({
    id: accountId,
    kdfSalt,
    authVerifier,
    kdfAlg: KDF_ALG,
    username,
    relayUrl,
  });

  // 5. Adopt MK under this device's enclave (custody Phase 2): replace the
  //    throwaway first-launch wrap with the *account* MK, so later launches
  //    recover it from the enclave alone (no re-login).
  const { deviceId } = await adoptMasterKeyIntoEnclave({
    keyStore,
    driver,
    masterKey,
  });

  // 5a. Lay down the local **password** door on MK. The relay just handed us
  //     exactly these bytes — `wrap(MK, KEK)` under the account's own salt — and
  //     until slice 9 nothing persisted them, so a joined device could open its
  //     store file with its password but had no local route from that password
  //     back to the master key. That is the one thing the boot-path repair needs
  //     after a keychain loss, and creation and recovery both write it already;
  //     join was the odd one out. Found by driving a joined device through a
  //     wiped keychain, not by reading the code.
  await createKeyWrapRepo(driver).add({
    wrappedKind: "master",
    principalKind: "password",
    // Copied onto a fresh array so it is ArrayBuffer-backed for the row write,
    // as `reauthenticate` does with the same field.
    ciphertext: Uint8Array.from(bootstrap.wrappedMasterKey),
    alg: ALG,
  });

  // 5b. Adopt the account recovery key so this device reveals the same phrase as
  //     the rest of the account, mirroring recoverAccount. wrap(recoveryKey, MK)
  //     lets us recover it from MK alone (this device never had the phrase).
  //     Optional so a pre-change relay still lets us join (we then keep our
  //     device-local key). Setting RECOVERY_KEY re-keys the at-rest sidecar on the
  //     next launch (`apps/desktop/src/main/db/open.ts`).
  if (bootstrap.wrappedRecoveryKey !== undefined) {
    const recoveryKey = unwrapKey(bootstrap.wrappedRecoveryKey, masterKey);
    await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
    // Lay the local `recovery` door this flow currently lacks.
    await createKeyWrapRepo(driver).add({
      wrappedKind: "master",
      principalKind: "recovery",
      ciphertext: wrapKey(masterKey, recoveryKey),
      alg: ALG,
    });
  }

  // 6. Register this device on the account.
  await createDeviceRepo(driver).register({
    id: deviceId,
    accountId,
    label: label ?? null,
    platform: platform ?? null,
  });

  return { deviceId, masterKey };
}

/**
 * Recover an account on a fresh device from the **recovery phrase** alone — the
 * "I forgot my password, on a new device" path (`model.md` §6). The relay holds
 * the recovery escrow (`wrap(MK, recoveryKey)`) and only `sha256` of the recovery
 * verifier, so this: looks the account up; proves possession of the recovery key
 * (its verifier) to fetch the escrow and unwrap MK; **sets a new password** and
 * resets the account's password door on the relay (the old password is gone, and
 * the relay credential is password-derived, so a recovered device must establish
 * a fresh one to sync); persists the local account; adopts MK under this device's
 * enclave; and adopts the account recovery key as this device's recovery key so
 * one phrase keeps covering both the account and the local file.
 *
 * Refuses if this device is already part of an account (like {@link joinAccount}).
 * A recovery key for a *different* account fails at the relay's verifier check.
 */
export async function recoverAccount(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  transport: RecoveryChannel;
  relayUrl: string;
  username: string;
  recoveryKey: Uint8Array;
  newPassword: string;
  label?: string;
  platform?: string;
}): Promise<KeySession> {
  const {
    keyStore,
    driver,
    transport,
    relayUrl,
    recoveryKey,
    newPassword,
    label,
    platform,
  } = opts;
  const username = normalizeUsername(opts.username);
  const accountRepo = createAccountRepo(driver);

  if ((await accountRepo.getSingleton()) !== undefined) {
    throw new Error("This device is already part of an account.");
  }

  // 1. Prelogin → account id. 2. Prove possession of the recovery key (its
  //    verifier) to fetch wrap(MK, recoveryKey); a wrong phrase → wrong verifier
  //    → the relay answers 401 here, before any unwrap.
  const { accountId } = await transport.lookup(username);
  const recoveryVerifier = deriveRecoveryVerifier(recoveryKey);
  // Copy onto a plain ArrayBuffer-backed array so it flows into the BLOB-typed
  // key_wrap field and the crypto primitives (the same posture as the KDF).
  const wrappedMasterKeyRecovery = Uint8Array.from(
    await transport.fetchRecovery({ accountId, recoveryVerifier }),
  );
  const masterKey = unwrapKey(wrappedMasterKeyRecovery, recoveryKey);

  // 3. Establish a new password and reset the account's password door on the
  //    relay (proven by the recovery verifier), so this device can authenticate
  //    sync going forward.
  const salt = generateSalt();
  const { kek, authVerifier } = deriveKeyMaterial(newPassword, salt);
  const wrappedMasterKey = wrapKey(masterKey, kek);
  await transport.resetCredentials({
    accountId,
    recoveryVerifier,
    authVerifier,
    kdfSalt: salt,
    wrappedMasterKey,
  });

  // 4. Persist the local account row under the recovered id + new salt/verifier.
  await accountRepo.create({
    id: accountId,
    kdfSalt: salt,
    authVerifier,
    kdfAlg: KDF_ALG,
    username,
    relayUrl,
  });

  // 5. Adopt MK under this device's enclave, and lay down the local password +
  //    recovery doors so later launches and an on-device recovery both work.
  const { deviceId } = await adoptMasterKeyIntoEnclave({
    keyStore,
    driver,
    masterKey,
  });
  const keyWrapRepo = createKeyWrapRepo(driver);
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "password",
    ciphertext: wrappedMasterKey,
    alg: ALG,
  });
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "recovery",
    ciphertext: wrappedMasterKeyRecovery,
    alg: ALG,
  });

  // Adopt the account recovery key as this device's recovery key, so the one
  // phrase the user holds keeps opening both the account and this device's local
  // file (the at-rest sidecar re-keys to it on the next launch).
  await keyStore.setSecret(RECOVERY_KEY, recoveryKey);

  // 6. Register this device on the account.
  await createDeviceRepo(driver).register({
    id: deviceId,
    accountId,
    label: label ?? null,
    platform: platform ?? null,
  });

  return { deviceId, masterKey };
}

/**
 * Re-authenticate this device after another device **reset the account password**
 * (the sibling of the recovery 401 follow-up, `status.md`). A reset rotates the
 * account's `kdfSalt` + `authVerifier` on the relay, so this device's stored
 * credential goes stale and its sync starts failing with 401. This refreshes the
 * credential from the *new* password — it is essentially "re-join an account you
 * are already on": look the account up to get the rotated salt, derive the new
 * KEK + verifier, authenticate against the relay (a wrong password → wrong
 * verifier → 401 there, before any unwrap), and on success update the local
 * `account` credentials + re-wrap the local `password` door.
 *
 * The master key is **never** touched: it stays in this device's enclave, so we
 * only refresh the password-derived door. As defense in depth the master key the
 * relay hands back (`unwrap(wrap(MK, newKEK))`) must equal this device's enclave
 * MK — if it differs (a different account), it refuses rather than corrupt the
 * local doors. Throws if sync is not enabled or the account has no username.
 */
export async function reauthenticate(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  transport: AccountBootstrapChannel;
  password: string;
}): Promise<void> {
  const { keyStore, driver, transport, password } = opts;
  const accountRepo = createAccountRepo(driver);
  const account = await accountRepo.getSingleton();
  if (account === undefined) {
    throw new Error("Sync is not enabled for this store.");
  }
  if (account.username === null) {
    throw new Error("This account has no username to re-authenticate.");
  }

  // 1. Prelogin → the rotated public salt (unauthed). Copy onto a fresh array so
  //    it is ArrayBuffer-backed for the account-row write.
  const lookup = await transport.lookup(account.username);
  const kdfSalt = Uint8Array.from(lookup.kdfSalt);

  // 2. Derive the KEK + verifier from the new password and the rotated salt.
  const { kek, authVerifier } = deriveKeyMaterial(password, kdfSalt);

  // 3. Authenticate with the verifier and fetch wrap(MK, newKEK); a wrong
  //    password → wrong verifier → 401 here, before any unwrap.
  const bootstrap = await transport.fetchBootstrap({
    accountId: account.id,
    authVerifier,
  });
  const wrappedMasterKey = Uint8Array.from(bootstrap.wrappedMasterKey);
  const masterKey = unwrapKey(wrappedMasterKey, kek);

  // 4. Defense in depth: the relay's MK must be this device's enclave MK — the
  //    same account — or we refuse rather than rewrite the local doors.
  const session = await ensureDeviceMasterKey({ keyStore, driver });
  if (!equalBytes(masterKey, session.masterKey)) {
    throw new Error("Re-authentication returned a different account's key.");
  }

  // 5. Update the local credential + refresh the password door, atomically.
  await driver.transaction(async () => {
    await accountRepo.updateCredentials({ kdfSalt, authVerifier });
    const keyWrapRepo = createKeyWrapRepo(driver);
    const old = await keyWrapRepo.getActive({
      wrappedKind: "master",
      principalKind: "password",
    });
    if (old !== undefined) await keyWrapRepo.revoke(old.id);
    await keyWrapRepo.add({
      wrappedKind: "master",
      principalKind: "password",
      ciphertext: wrappedMasterKey,
      alg: ALG,
    });
  });
}

/** Fetch the active `wrap(MK, <door>)` row and unwrap it under `key`. */
async function unwrapMasterKeyUnder(
  driver: SqliteDriver,
  principalKind: "password" | "recovery",
  key: Uint8Array,
): Promise<Uint8Array> {
  const wrap = await createKeyWrapRepo(driver).getActive({
    wrappedKind: "master",
    principalKind,
  });
  if (wrap === undefined) {
    throw new Error(
      `No ${principalKind} unlock door exists for the master key.`,
    );
  }
  return unwrapKey(wrap.ciphertext, key);
}
