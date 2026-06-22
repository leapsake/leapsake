import { describe, expect, it } from "vitest";
import {
  DATABASE_KEY,
  createInMemoryKeyStore,
  ensureDatabaseKey,
  rawKeyLiteral,
} from "../src/index.js";

describe("ensureDatabaseKey", () => {
  it("mints a 32-byte key on first launch and returns the same one after", async () => {
    const keyStore = createInMemoryKeyStore();

    const first = await ensureDatabaseKey(keyStore);
    expect(first).toHaveLength(32);

    const second = await ensureDatabaseKey(keyStore);
    expect(second).toEqual(first); // idempotent — no re-mint
  });

  it("persists the key under the keystore's db-key id", async () => {
    const keyStore = createInMemoryKeyStore();
    const minted = await ensureDatabaseKey(keyStore);

    expect(await keyStore.getSecret(DATABASE_KEY)).toEqual(minted);
  });
});

describe("rawKeyLiteral", () => {
  it("renders a key as SQLCipher's x'<64 hex>' raw-key form", () => {
    const key = new Uint8Array(32).fill(0xab);
    expect(rawKeyLiteral(key)).toBe(`x'${"ab".repeat(32)}'`);
  });
});
