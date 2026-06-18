import {
  ALG,
  type KeyStore,
  bytesToUtf8,
  generateKey,
  unwrapKey,
  utf8ToBytes,
  wrapKey,
} from "@leapsake/crypto";
import { type SqliteDriver, createKeyWrapRepo } from "@leapsake/data";

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
