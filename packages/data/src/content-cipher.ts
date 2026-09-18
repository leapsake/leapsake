import { bytesToUtf8, utf8ToBytes } from "@leapsake/bytes";
import {
  ALG,
  generateKey,
  open,
  seal,
  unwrapKey,
  wrapKey,
} from "@leapsake/crypto";
import {
  type ContentKeyRepo,
  createContentKeyRepo,
} from "./content-key-repo.js";
import { type KeyWrapRepo, createKeyWrapRepo } from "./key-wrap-repo.js";
import type { SqliteDriver } from "./driver.js";

/**
 * Per-item field encryption under a content key stored only as `wrap(CK, MK)`.
 * ⚠️ Unused; reviving it needs the account merge to re-wrap (README).
 */
export interface ContentCipher {
  /** Seal `plaintext` for an entity, minting or reusing its content key. */
  sealField(
    entityType: string,
    entityId: string,
    plaintext: string,
  ): Promise<Uint8Array>;
  /** Decrypt `ciphertext` previously produced by {@link sealField}. */
  openField(
    entityType: string,
    entityId: string,
    ciphertext: Uint8Array,
  ): Promise<string>;
}

/** A {@link ContentCipher} bound to an unlocked master key. */
export function createContentCipher(opts: {
  driver: SqliteDriver;
  masterKey: Uint8Array;
}): ContentCipher {
  const { driver, masterKey } = opts;
  const contentKeys: ContentKeyRepo = createContentKeyRepo(driver);
  const keyWraps: KeyWrapRepo = createKeyWrapRepo(driver);

  /** The CK for an entity, recovering it from `wrap(CK, MK)`. */
  async function getContentKey(
    entityType: string,
    entityId: string,
  ): Promise<Uint8Array | undefined> {
    const ck = await contentKeys.getForEntity(entityType, entityId);
    if (ck === undefined) return undefined;
    const wrap = await keyWraps.getActive({
      wrappedKind: "content",
      contentKeyId: ck.id,
      principalKind: "master",
    });
    if (wrap === undefined) return undefined;
    return unwrapKey(wrap.ciphertext, masterKey);
  }

  return {
    async sealField(entityType, entityId, plaintext) {
      let key = await getContentKey(entityType, entityId);
      if (key === undefined) {
        // First encrypted field for this entity: mint a CK and persist it as
        // wrap(CK, MK) (the owner's unlock path), re-encrypting nothing else.
        key = generateKey();
        const ck = await contentKeys.create({ entityType, entityId });
        await keyWraps.add({
          wrappedKind: "content",
          contentKeyId: ck.id,
          principalKind: "master",
          ciphertext: wrapKey(key, masterKey),
          alg: ALG,
        });
      }
      return seal(utf8ToBytes(plaintext), key);
    },

    async openField(entityType, entityId, ciphertext) {
      const key = await getContentKey(entityType, entityId);
      if (key === undefined) {
        throw new Error(
          `no content key for ${entityType} ${entityId}; cannot decrypt`,
        );
      }
      return bytesToUtf8(open(ciphertext, key));
    },
  };
}
