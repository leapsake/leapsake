import type { KeyStore } from "@leapsake/crypto";
import { describe, expect, it } from "vitest";
import { ensureDatabaseKey } from "../src/main/db/database-key.js";

/** A minimal in-memory {@link KeyStore} standing in for the OS enclave adapter. */
function fakeKeyStore(): KeyStore {
  const store = new Map<string, Uint8Array>();
  return {
    async getSecret(id) {
      return store.get(id);
    },
    async setSecret(id, bytes) {
      store.set(id, bytes);
    },
    async deleteSecret(id) {
      store.delete(id);
    },
  };
}

describe("ensureDatabaseKey", () => {
  it("mints a 32-byte key on first launch and returns the same one after", async () => {
    const keyStore = fakeKeyStore();

    const first = await ensureDatabaseKey(keyStore);
    expect(first).toHaveLength(32);

    const second = await ensureDatabaseKey(keyStore);
    expect(second).toEqual(first); // idempotent — no re-mint
  });

  it("persists the key under the keystore (recoverable after a fresh helper call)", async () => {
    const keyStore = fakeKeyStore();
    const minted = await ensureDatabaseKey(keyStore);

    expect(await keyStore.getSecret("db-key")).toEqual(minted);
  });
});
