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

/** A running device's id and in-memory master key. ⚠️ Never zeroized, so it
 *  must never reach a log or crash report (README, "Invariants"). */
export interface KeySession {
  deviceId: string;
  masterKey: Uint8Array;
}

/** The minimum account-password length, re-exported through core so both
 *  clients check one number. */
export const MIN_PASSWORD_LENGTH = 12;

/** KeyStore id holding this device's stable UUID (UTF-8 bytes). */
const DEVICE_ID_KEY = "device-id";
/** KeyStore id holding this device's 32-byte enclave secret. */
const ENCLAVE_KEY = "enclave";

/** Every KeyStore id this app writes, so a factory reset can clear them all.
 *  Keep it in step with every `keyStore.setSecret` call. */
export const KEYSTORE_SECRET_IDS = [
  DATABASE_KEY,
  RECOVERY_KEY,
  DEVICE_ID_KEY,
  ENCLAVE_KEY,
] as const;

/**
 * Mint-or-read this device's stable id, touching only the keychain, so it works
 * before any account exists. An account created later adopts the same id.
 */
export async function ensureLocalDeviceId(keyStore: KeyStore): Promise<string> {
  const stored = await keyStore.getSecret(DEVICE_ID_KEY);
  if (stored !== undefined) return bytesToUtf8(stored);
  const deviceId = crypto.randomUUID();
  await keyStore.setSecret(DEVICE_ID_KEY, utf8ToBytes(deviceId));
  return deviceId;
}

/**
 * The device id and enclave secret, minted if missing so a wiped keychain can
 * be repaired. Keychain-only, and private: it returns the raw secret.
 */
async function ensureDeviceIdentity(
  keyStore: KeyStore,
): Promise<{ deviceId: string; enclaveKey: Uint8Array }> {
  // The same keychain entry, so a pre-account id is reused, not replaced.
  const deviceId = await ensureLocalDeviceId(keyStore);

  // Device enclave secret — the local unlock path for MK, held off-DB.
  let enclaveKey = await keyStore.getSecret(ENCLAVE_KEY);
  if (enclaveKey === undefined) {
    enclaveKey = generateKey();
    await keyStore.setSecret(ENCLAVE_KEY, enclaveKey);
  }

  return { deviceId, enclaveKey };
}

/**
 * Bind `masterKey` to this device's enclave, or answer `"unchanged"` when it is
 * already bound (every re-login). Revoke precedes add, in one transaction.
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
 * Recover the device's master key from its enclave wrap, minting one only on a
 * store with no account. With an account it throws: the door must re-adopt.
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

/** Whether this store holds an account, with its non-secret identity only. */
export interface SyncStatus {
  hasAccount: boolean;
  accountId?: string;
  createdAt?: number;
  username?: string;
  relayUrl?: string;
}

/** Read the account singleton as a {@link SyncStatus}. */
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
 * Roll back account creation: remove the account and device rows and revoke the
 * password and recovery wraps, leaving data and the enclave wrap. Local only.
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

/** The master key opened by a password or recovery door. Not a
 *  {@link KeySession}: binding it to a device is a separate step. */
export interface UnlockedMasterKey {
  accountId: string;
  masterKey: Uint8Array;
}

/** What the relay needs for a second device to join by username and password.
 *  All public or blind: the relay can store it but never read MK. */
export interface AccountBootstrap {
  accountId: string;
  /** The login handle, or `null` while the account is not relay-bound. */
  username: string | null;
  kdfSalt: Uint8Array;
  authVerifier: Uint8Array;
  wrappedMasterKey: Uint8Array;
  /** `wrap(recoveryKey, MK)`, so a password-joining device recovers the
   *  account's phrase from MK and every device shows one phrase. */
  wrappedRecoveryKey: Uint8Array;
  /** `wrap(MK, recoveryKey)`, the recovery escrow: a device that lost its
   *  password recovers MK from the phrase alone. */
  wrappedMasterKeyRecovery: Uint8Array;
  /** The recovery auth verifier; the relay stores only its hash. */
  recoveryVerifier: Uint8Array;
}

/** A username's canonical form, matching the relay's. Exported so
 *  `bindRelayToAccount` shares this one rule. */
export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** The slice of the relay transport {@link joinAccount} needs; account
 *  adoption, not per-record sync. */
export interface AccountBootstrapChannel {
  /** Prelogin: resolve a username → account id + public salt (unauthed). */
  lookup(username: string): Promise<{ accountId: string; kdfSalt: Uint8Array }>;
  /** Bearer-authed: `wrap(MK, KEK)`, plus the `wrap(recoveryKey, MK)` escrow
   *  when the relay has one. */
  fetchBootstrap(creds: {
    accountId: string;
    authVerifier: Uint8Array;
  }): Promise<{
    wrappedMasterKey: Uint8Array;
    wrappedRecoveryKey?: Uint8Array;
  }>;
}

/** The relay channel {@link recoverAccount} needs: fetch the recovery escrow,
 *  and replace the password door, both proved by the recovery verifier. */
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
 * Create the account: add password and recovery wraps of the existing master
 * key, re-encrypting nothing. Returns the phrase to show once; never repeats.
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
  // The device's existing recovery key, already sealing the db-key, so one
  // phrase opens both the file and the account.
  const recoveryKey = await ensureRecoveryKey(keyStore);
  const recoveryVerifier = deriveRecoveryVerifier(recoveryKey);
  // The local `password` door, also handed to the relay for joining devices.
  const wrappedMasterKey = wrapKey(masterKey, kek);
  // The local `recovery` door, also escrowed on the relay.
  const wrappedMasterKeyRecovery = wrapKey(masterKey, recoveryKey);
  // The inverse escrow, so a joining device can reveal the same phrase. Leaks
  // nothing: MK compromise is already total.
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

/** Unlock the account's master key from the password alone. Throws on a wrong
 *  password, checked by verifier before any unwrap. */
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

/** Unlock the master key from the recovery key. No verifier: the key is
 *  high-entropy, so a wrong one fails the AEAD unwrap. */
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
 * The door a boot came through, with the key it already derived, never the
 * password: the repair reuses that KEK instead of a second Argon2id pass.
 */
export type AdoptionDoor =
  | { kind: "password"; kek: Uint8Array; authVerifier: Uint8Array }
  | { kind: "recovery"; recoveryKey: Uint8Array };

/**
 * After a door unlock, bind the account's master key to this enclave so a wiped
 * keychain never mints a new one. Run between migrations and the key session.
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
    // A mismatched verifier is a sidecar left by a crash mid password change;
    // its KEK cannot open the wrap, so send the user to the phrase door.
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
    // A repaired device is a new device id, so register it. The old device and
    // enclave rows stay: unmatchable, and sweeping them is revocation work.
    await createDeviceRepo(driver).register({
      id: deviceId,
      accountId: account.id,
      platform: platform ?? null,
    });
  }
  return status;
}

/**
 * Join an existing account on a fresh device: authenticate by password, unwrap
 * MK, and adopt it under this enclave. Refuses a device already in an account.
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

  // 1. Prelogin: account id and public salt. Copied so the salt is
  //    ArrayBuffer-backed for the row write.
  const lookup = await transport.lookup(username);
  const { accountId } = lookup;
  const kdfSalt = Uint8Array.from(lookup.kdfSalt);

  // 2. Derive the KEK and verifier from the password and salt.
  const { kek, authVerifier } = deriveKeyMaterial(password, kdfSalt);

  // 3. Authenticate and fetch wrap(MK, KEK); a wrong password is a 401 here,
  //    before any unwrap.
  const bootstrap = await transport.fetchBootstrap({
    accountId,
    authVerifier,
  });
  const masterKey = unwrapKey(bootstrap.wrappedMasterKey, kek);

  // 4. The account row under the looked-up id: the relay namespace.
  await accountRepo.create({
    id: accountId,
    kdfSalt,
    authVerifier,
    kdfAlg: KDF_ALG,
    username,
    relayUrl,
  });

  // 5. Adopt MK under this enclave, so later launches need no re-login.
  const { deviceId } = await adoptMasterKeyIntoEnclave({
    keyStore,
    driver,
    masterKey,
  });

  // 5a. The local password door, which the keychain-loss repair needs.
  await createKeyWrapRepo(driver).add({
    wrappedKind: "master",
    principalKind: "password",
    // ArrayBuffer-backed for the row write.
    ciphertext: Uint8Array.from(bootstrap.wrappedMasterKey),
    alg: ALG,
  });

  // 5b. Adopt the account's recovery key, so this device shows the same phrase;
  //     the at-rest sidecar re-keys to it on next launch. Absent on old relays.
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
 * Recover an account on a fresh device from the recovery phrase: fetch the
 * escrow, set a new password on the relay, and adopt MK and the phrase locally.
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

  // 1. Prelogin. 2. Prove the recovery key to fetch wrap(MK, recoveryKey); a
  //    wrong phrase is a 401 here, before any unwrap.
  const { accountId } = await transport.lookup(username);
  const recoveryVerifier = deriveRecoveryVerifier(recoveryKey);
  // ArrayBuffer-backed for the BLOB column and the crypto primitives.
  const wrappedMasterKeyRecovery = Uint8Array.from(
    await transport.fetchRecovery({ accountId, recoveryVerifier }),
  );
  const masterKey = unwrapKey(wrappedMasterKeyRecovery, recoveryKey);

  // 3. A new password, and the relay's password door reset to it, so this
  //    device can authenticate sync.
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

  // 4. Persist the local account row under the recovered id + new
  // salt/verifier.
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

  // One phrase opens both the account and this device's file; the at-rest
  // sidecar re-keys to it on next launch.
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
 * Refresh this device's credential after another device reset the password.
 * MK is untouched; refuses if the relay's MK is not this enclave's.
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

  // 1. Prelogin → the rotated public salt (unauthed). Copy onto a fresh array
  // so it is ArrayBuffer-backed for the account-row write.
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
