import { describe, expect, it } from "vitest";
import { createInMemoryKeyStore } from "../src/keystore.js";
import { generateKey } from "../src/keys.js";
import {
  RECOVERY_KEY,
  ensureRecoveryKey,
  openDbKeyFromRecovery,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "../src/recovery.js";

describe("ensureRecoveryKey", () => {
  it("mints once and returns the same key thereafter", async () => {
    const store = createInMemoryKeyStore();
    const first = await ensureRecoveryKey(store);
    const second = await ensureRecoveryKey(store);
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(await store.getSecret(RECOVERY_KEY)).toEqual(first);
  });
});

describe("readRecoveryKey", () => {
  // The whole reason this exists: an Open device must stay keyless no matter who
  // asks. Reading has to be a question, not an instruction (model.md §7.2).
  it("returns undefined for a keyless device and mints nothing", async () => {
    const store = createInMemoryKeyStore();
    expect(await readRecoveryKey(store)).toBeUndefined();
    expect(await store.getSecret(RECOVERY_KEY)).toBeUndefined();
  });

  it("returns the existing key once one has been minted", async () => {
    const store = createInMemoryKeyStore();
    const minted = await ensureRecoveryKey(store);
    expect(await readRecoveryKey(store)).toEqual(minted);
  });
});

describe("sealDbKeyForRecovery / openDbKeyFromRecovery", () => {
  it("round-trips the db-key under the recovery key", () => {
    const dbKey = generateKey();
    const recoveryKey = generateKey();
    const sidecar = sealDbKeyForRecovery(dbKey, recoveryKey);
    expect(openDbKeyFromRecovery(sidecar, recoveryKey)).toEqual(dbKey);
  });

  it("rejects a wrong recovery key (AEAD failure)", () => {
    const sidecar = sealDbKeyForRecovery(generateKey(), generateKey());
    expect(() => openDbKeyFromRecovery(sidecar, generateKey())).toThrow();
  });

  it("rejects a blob without the magic header", () => {
    expect(() =>
      openDbKeyFromRecovery(new Uint8Array(60), generateKey()),
    ).toThrow(/sidecar format/);
  });
});
