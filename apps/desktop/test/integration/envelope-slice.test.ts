import {
  ALG,
  createInMemoryKeyStore,
  generateKey,
  open,
  seal,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type SqliteDriver,
  createContentKeyRepo,
  createKeyWrapRepo,
  runMigrations,
} from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The envelope vertical slice (jaunty-soaring-pinwheel plan): mint a master key,
 * store it enclave-wrapped, wrap a content key under the master key, persist
 * both wraps, then — from cold handles — read back, unwrap, and decrypt a
 * payload. Proves the core "the DB only ever holds ciphertext + wrapped keys"
 * property (encryption.md §3) end-to-end through `packages/crypto`, the
 * `KeyStore` port, and the `content_key` + `key_wrap` data layer.
 */
describe("envelope slice", () => {
  let driver: SqliteDriver;
  let cleanup: () => void;

  beforeEach(async () => {
    ({ driver, cleanup } = makeEncryptedTestDriver());
    await runMigrations(driver);
  });

  afterEach(() => {
    cleanup();
  });

  it("round-trips a payload through enclave → MK → CK → ciphertext and back", async () => {
    const keystore = createInMemoryKeyStore();
    const deviceId = crypto.randomUUID();
    const entityId = crypto.randomUUID();
    const payload = new TextEncoder().encode("Ada Lovelace, born 1815");

    // --- Write side -------------------------------------------------------
    {
      const contentKeyRepo = createContentKeyRepo(driver);
      const keyWrapRepo = createKeyWrapRepo(driver);

      // 1. Device enclave secret, held off-DB in the KeyStore.
      const enclave = generateKey();
      await keystore.setSecret(deviceId, enclave);

      // 2. Master key, persisted only as its enclave wrapping.
      const mk = generateKey();
      await keyWrapRepo.add({
        wrappedKind: "master",
        principalKind: "enclave",
        principalRef: deviceId,
        ciphertext: wrapKey(mk, enclave),
        alg: ALG,
      });

      // 3. Content key, registered then persisted only as wrap(CK, MK).
      const ck = generateKey();
      const contentKey = await contentKeyRepo.create({
        entityType: "person",
        entityId,
      });
      await keyWrapRepo.add({
        wrappedKind: "content",
        contentKeyId: contentKey.id,
        principalKind: "master",
        ciphertext: wrapKey(ck, mk),
        alg: ALG,
      });

      // 4. Encrypt a sample record with CK; only the ciphertext is kept.
      const sealed = seal(payload, ck);
      await keystore.setSecret(`payload:${entityId}`, sealed);

      // Nothing plaintext persisted: every stored wrap differs from the raw key.
      const mkWrap = await keyWrapRepo.getActive({
        wrappedKind: "master",
        principalKind: "enclave",
        principalRef: deviceId,
      });
      const ckWrap = await keyWrapRepo.getActive({
        wrappedKind: "content",
        contentKeyId: contentKey.id,
        principalKind: "master",
      });
      expect(mkWrap?.ciphertext).not.toEqual(mk);
      expect(ckWrap?.ciphertext).not.toEqual(ck);

      // Stash originals for the post-read assertions (off-DB, like the device).
      await keystore.setSecret("expected:mk", mk);
      await keystore.setSecret("expected:ck", ck);
    }

    // --- Cold read-back (fresh handles, nothing carried over) --------------
    const contentKeyRepo = createContentKeyRepo(driver);
    const keyWrapRepo = createKeyWrapRepo(driver);

    // Recover the enclave secret from the KeyStore.
    const enclave = await keystore.getSecret(deviceId);
    expect(enclave).toBeDefined();

    // Unwrap MK using the enclave secret.
    const mkWrap = await keyWrapRepo.getActive({
      wrappedKind: "master",
      principalKind: "enclave",
      principalRef: deviceId,
    });
    expect(mkWrap).toBeDefined();
    const mk = unwrapKey(mkWrap!.ciphertext, enclave!);

    // Find the content key for the entity, unwrap CK under MK.
    const contentKey = await contentKeyRepo.getForEntity("person", entityId);
    expect(contentKey).toBeDefined();
    const ckWrap = await keyWrapRepo.getActive({
      wrappedKind: "content",
      contentKeyId: contentKey!.id,
      principalKind: "master",
    });
    expect(ckWrap).toBeDefined();
    const ck = unwrapKey(ckWrap!.ciphertext, mk);

    // Decrypt the sample record with the recovered CK.
    const sealed = await keystore.getSecret(`payload:${entityId}`);
    const decrypted = open(sealed!, ck);

    // Recovered keys equal the originals, and the payload round-trips.
    expect(mk).toEqual(await keystore.getSecret("expected:mk"));
    expect(ck).toEqual(await keystore.getSecret("expected:ck"));
    expect(decrypted).toEqual(payload);
    expect(new TextDecoder().decode(decrypted)).toBe("Ada Lovelace, born 1815");
  });
});
