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
 * The device id and enclave secret, minted if missing so a wiped keychain can be
 * repaired. Keychain-only, and private: it returns the raw enclave secret.
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
  /** The chosen login handle, or `null` if the account is not yet relay-bound. */
  username: string | null;
  kdfSalt: Uint8Array;
  authVerifier: Uint8Array;
  wrappedMasterKey: Uint8Array;
  /** `wrap(recoveryKey, MK)`, so a password-joining device recovers the account's
   *  phrase from MK and every device shows one phrase. */
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
 * key, re-encrypting nothing. Returns the phrase to show once; refuses a repeat.
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
