import { createInMemoryKeyStore, generateKey } from "@leapsake/crypto";
import {
  type SqliteDriver,
  createKeyWrapRepo,
  runMigrations,
} from "@leapsake/data";
import { ensureDeviceMasterKey, ensureLocalDeviceId } from "@leapsake/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * Custody Phase 0: the device master-key bootstrap (the first KeyStore
 * consumer). Proves MK is minted once, recovered identically on a cold launch,
 * never stored in the clear, and genuinely bound to the device enclave secret.
 */
describe("ensureDeviceMasterKey", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => {
    cleanup();
  });

  it("mints the MK on first run, persisting only its enclave wrapping", async () => {
    const keyStore = createInMemoryKeyStore();
    const session = await ensureDeviceMasterKey({
      keyStore,
      driver,
    });

    // The device id + enclave secret now live in the KeyStore.
    expect(await keyStore.getSecret("device-id")).toBeDefined();
    expect(await keyStore.getSecret("enclave")).toBeDefined();

    // Exactly one active master/enclave wrap exists, and it is ciphertext —
    // never the raw MK bytes.
    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'master' AND principal_kind = 'enclave' AND deleted_at IS NULL",
    );
    expect(rows[0]?.n).toBe(1);

    const wrap = await createKeyWrapRepo(driver).getActive({
      wrappedKind: "master",
      principalKind: "enclave",
      principalRef: session.deviceId,
    });
    expect(wrap?.ciphertext).not.toEqual(session.masterKey);
  });

  it("recovers the identical MK on a cold relaunch without adding rows", async () => {
    // First launch mints; second launch (fresh repo handles, same KeyStore +
    // DB) must recover byte-for-byte and write nothing new.
    const keyStore = createInMemoryKeyStore();
    const first = await ensureDeviceMasterKey({
      keyStore,
      driver,
    });
    const second = await ensureDeviceMasterKey({
      keyStore,
      driver,
    });

    expect(second.deviceId).toBe(first.deviceId);
    expect(second.masterKey).toEqual(first.masterKey);

    const rows = await driver.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM key_wrap WHERE wrapped_kind = 'master' AND deleted_at IS NULL",
    );
    expect(rows[0]?.n).toBe(1);
  });

  it("cannot unwrap the MK without the device's enclave secret", async () => {
    // Mint with one KeyStore, then point a second launch at a KeyStore that
    // carries the same device id but a different enclave secret — the AEAD
    // authentication must reject the wrap.
    const keyStore = createInMemoryKeyStore();
    const session = await ensureDeviceMasterKey({
      keyStore,
      driver,
    });

    const tampered = createInMemoryKeyStore();
    await tampered.setSecret(
      "device-id",
      (await keyStore.getSecret("device-id"))!,
    );
    await tampered.setSecret("enclave", generateKey());

    await expect(
      ensureDeviceMasterKey({
        keyStore: tampered,
        driver,
      }),
    ).rejects.toThrow();

    // The original session is untouched and still valid.
    expect(session.masterKey).toBeInstanceOf(Uint8Array);
  });
});

/**
 * A device id must exist before any account does, since "encryption follows
 * custody" means {@link ensureDeviceMasterKey} never runs for a plaintext
 * store.
 */
describe("ensureLocalDeviceId", () => {
  it("mints an id touching only the keychain — no DB row", async () => {
    const keyStore = createInMemoryKeyStore();
    const deviceId = await ensureLocalDeviceId(keyStore);

    expect(deviceId).toEqual(expect.any(String));
    expect(await keyStore.getSecret("device-id")).toBeDefined();
    // No enclave secret, no key_wrap row — this half of Phase 0 alone must
    // not reach for either.
    expect(await keyStore.getSecret("enclave")).toBeUndefined();
  });

  it("is idempotent — a second call returns the same id", async () => {
    const keyStore = createInMemoryKeyStore();
    const first = await ensureLocalDeviceId(keyStore);
    const second = await ensureLocalDeviceId(keyStore);
    expect(second).toBe(first);
  });

  it("is adopted by ensureDeviceMasterKey with no reconciliation step", async () => {
    // A device id minted before any account exists (the account-less path)
    // must be the exact id ensureDeviceMasterKey later mints its enclave
    // wrap under — the whole point of sharing the DEVICE_ID_KEY entry.
    const driver = makeEncryptedTestDriver();
    await runMigrations(driver.driver);
    const keyStore = createInMemoryKeyStore();

    const preAccountId = await ensureLocalDeviceId(keyStore);
    const session = await ensureDeviceMasterKey({
      keyStore,
      driver: driver.driver,
    });

    expect(session.deviceId).toBe(preAccountId);
    driver.cleanup();
  });
});
