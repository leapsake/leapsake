import {
  ALG,
  KDF_ALG,
  type KeyStore,
  bytesToUtf8,
  deriveKeyMaterial,
  equalBytes,
  generateKey,
  generateRecoveryKey,
  generateSalt,
  unwrapKey,
  utf8ToBytes,
  wrapKey,
} from "@leapsake/crypto";
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
 */
export interface KeySession {
  deviceId: string;
  masterKey: Uint8Array;
}

/** KeyStore id holding this device's stable UUID (UTF-8 bytes). */
const DEVICE_ID_KEY = "device-id";
/** KeyStore id holding this device's 32-byte enclave secret. */
const ENCLAVE_KEY = "enclave";

/**
 * Custody Phase 0 (encryption/custody-sequence.md): make the device's master
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
 */
export async function ensureDeviceMasterKey(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
}): Promise<KeySession> {
  const { keyStore, driver } = opts;
  const keyWrapRepo = createKeyWrapRepo(driver);

  // 1. Stable device id — minted once, then read back each launch.
  let deviceId: string;
  const storedDeviceId = await keyStore.getSecret(DEVICE_ID_KEY);
  if (storedDeviceId === undefined) {
    deviceId = crypto.randomUUID();
    await keyStore.setSecret(DEVICE_ID_KEY, utf8ToBytes(deviceId));
  } else {
    deviceId = bytesToUtf8(storedDeviceId);
  }

  // 2. Device enclave secret — the local unlock path for MK, held off-DB.
  let enclaveKey = await keyStore.getSecret(ENCLAVE_KEY);
  if (enclaveKey === undefined) {
    enclaveKey = generateKey();
    await keyStore.setSecret(ENCLAVE_KEY, enclaveKey);
  }

  // 3. Master key — minted on first run, recovered after. The DB only ever
  //    holds wrap(MK, enclave), never MK itself.
  const existing = await keyWrapRepo.getActive({
    wrappedKind: "master",
    principalKind: "enclave",
    principalRef: deviceId,
  });
  if (existing !== undefined) {
    return { deviceId, masterKey: unwrapKey(existing.ciphertext, enclaveKey) };
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
 * Custody Phase 1 (encryption/custody-sequence.md): **enable sync** — promote a
 * single, enclave-only device to an account with a portable **password** unlock
 * door, plus a one-time **recovery key**. This is the first crypto that leaves
 * AEAD-only territory: it derives a KEK with Argon2id (security-review.md).
 *
 * The KEK layer (`model.md` §4) is the whole point: the master key is unchanged
 * and **nothing is re-encrypted** — we only add two *new wrappings* of the same
 * MK (one under the Argon2id KEK, one under the recovery key) alongside the
 * existing enclave wrapping. The server-stored `auth_verifier` is a separate
 * HKDF branch of the password seed, so it authenticates login while revealing
 * nothing about the KEK (`model.md` §9.3).
 *
 * Returns the created {@link Account} and the recovery key to show the user
 * **once** (the caller/UI owns display + encoding; we never store it). Refuses
 * if sync is already enabled — the recovery key cannot be re-derived, so
 * re-enabling must be an explicit reset, not a silent overwrite.
 */
export async function enableSync(opts: {
  keyStore: KeyStore;
  driver: SqliteDriver;
  password: string;
  label?: string;
  platform?: string;
}): Promise<{ account: Account; recoveryKey: Uint8Array }> {
  const { keyStore, driver, password, label, platform } = opts;
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
  const recoveryKey = generateRecoveryKey();

  const account = await accountRepo.create({
    kdfSalt: salt,
    authVerifier,
    kdfAlg: KDF_ALG,
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
    ciphertext: wrapKey(masterKey, kek),
    alg: ALG,
  });
  await keyWrapRepo.add({
    wrappedKind: "master",
    principalKind: "recovery",
    ciphertext: wrapKey(masterKey, recoveryKey),
    alg: ALG,
  });

  return { account, recoveryKey };
}

/**
 * Custody Phase 2 / login (encryption/custody-sequence.md): unlock the account's
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
