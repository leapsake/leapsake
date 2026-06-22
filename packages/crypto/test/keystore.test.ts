import { describe, expect, it } from "vitest";
import { createInMemoryKeyStore } from "../src/keystore.js";

describe("createInMemoryKeyStore", () => {
  it("returns undefined for an unknown id", async () => {
    const store = createInMemoryKeyStore();
    expect(await store.getSecret("missing")).toBeUndefined();
  });

  it("sets and gets a secret", async () => {
    const store = createInMemoryKeyStore();
    const secret = new Uint8Array([1, 2, 3, 4]);
    await store.setSecret("device-1", secret);
    expect(await store.getSecret("device-1")).toEqual(secret);
  });

  it("overwrites an existing secret", async () => {
    const store = createInMemoryKeyStore();
    await store.setSecret("device-1", new Uint8Array([1]));
    await store.setSecret("device-1", new Uint8Array([2]));
    expect(await store.getSecret("device-1")).toEqual(new Uint8Array([2]));
  });

  it("deletes a secret", async () => {
    const store = createInMemoryKeyStore();
    await store.setSecret("device-1", new Uint8Array([1]));
    await store.deleteSecret("device-1");
    expect(await store.getSecret("device-1")).toBeUndefined();
  });

  it("copies bytes so stored secrets can't be mutated by reference", async () => {
    const store = createInMemoryKeyStore();
    const secret = new Uint8Array([1, 2, 3]);
    await store.setSecret("device-1", secret);
    secret[0] = 99; // mutate the caller's copy after storing
    const fetched = await store.getSecret("device-1");
    expect(fetched).toEqual(new Uint8Array([1, 2, 3]));
    fetched![0] = 42; // mutate the returned copy
    expect(await store.getSecret("device-1")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});
