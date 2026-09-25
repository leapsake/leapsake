import {
  type KeyStore,
  RECOVERY_KEY,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import type { AdoptionDoor } from "./session.js";

/** Reseal the recovery door under this device's recovery key, adopting a
 *  phrase unlock's first. Never mints one: with none, the door is untouched. */
export async function resealRecoveryDoor(opts: {
  keyStore: KeyStore;
  dbKey: Uint8Array;
  door?: AdoptionDoor;
  writeRecovery: (bytes: Uint8Array) => Promise<void> | void;
}): Promise<void> {
  const { keyStore, dbKey, door, writeRecovery } = opts;
  let recoveryKey: Uint8Array | undefined;
  if (door?.kind === "recovery") {
    recoveryKey = door.recoveryKey;
    await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
  } else {
    recoveryKey = await readRecoveryKey(keyStore);
  }
  if (recoveryKey !== undefined) {
    await writeRecovery(sealDbKeyForRecovery(dbKey, recoveryKey));
  }
}
