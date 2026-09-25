import {
  RECOVERY_KEY,
  createInMemoryKeyStore,
  openDbKeyFromRecovery,
} from "@leapsake/crypto";
import { describe, expect, it } from "vitest";
import { resealRecoveryDoor } from "../src/index.js";

const randomKey = () => crypto.getRandomValues(new Uint8Array(32));

/** Records every door the rule writes. */
function doorSpy() {
  const written: Uint8Array[] = [];
  return {
    written,
    writeRecovery: (bytes: Uint8Array) => {
      written.push(bytes);
    },
  };
}

describe("resealRecoveryDoor", () => {
  it("seals the door under the recovery key this device holds", async () => {
    const keyStore = createInMemoryKeyStore();
    const recoveryKey = randomKey();
    await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
    const dbKey = randomKey();
    const { written, writeRecovery } = doorSpy();

    await resealRecoveryDoor({ keyStore, dbKey, writeRecovery });

    expect(written).toHaveLength(1);
    expect(openDbKeyFromRecovery(written[0]!, recoveryKey)).toEqual(dbKey);
  });

  it("adopts the phrase's recovery key and seals under it", async () => {
    const keyStore = createInMemoryKeyStore();
    const recoveryKey = randomKey();
    const dbKey = randomKey();
    const { written, writeRecovery } = doorSpy();

    await resealRecoveryDoor({
      keyStore,
      dbKey,
      door: { kind: "recovery", recoveryKey },
      writeRecovery,
    });

    expect(await keyStore.getSecret(RECOVERY_KEY)).toEqual(recoveryKey);
    expect(openDbKeyFromRecovery(written[0]!, recoveryKey)).toEqual(dbKey);
  });

  it("writes nothing and mints nothing when no recovery key is held", async () => {
    const keyStore = createInMemoryKeyStore();
    const { written, writeRecovery } = doorSpy();

    await resealRecoveryDoor({ keyStore, dbKey: randomKey(), writeRecovery });

    expect(written).toEqual([]);
    expect(await keyStore.getSecret(RECOVERY_KEY)).toBeUndefined();
  });
});
