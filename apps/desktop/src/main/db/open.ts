import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  DATABASE_KEY,
  type KeyStore,
  ensureDatabaseKey,
} from "@leapsake/crypto";
import {
  type AdoptionDoor,
  type UnlockAnswer,
  type UnlockRequest,
  resealRecoveryDoor,
  unlockStore,
} from "@leapsake/core";
import type { SqliteDriver } from "@leapsake/data";
import {
  encryptedSqliteDriver,
  openEncryptedDatabase,
} from "./encrypted-sqlite-driver.js";
import {
  passwordSidecarPath,
  readSidecar,
  recoverySidecarPath,
  writeSidecar,
} from "./sidecars.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * Open the store in its custody state: plaintext and keyless, or encrypted
 * under the keychain's db-key, else unlocked through a sidecar door.
 */
export async function openAppDatabase(opts: {
  dbPath: string;
  custody: "plaintext" | "encrypted";
  keyStore: KeyStore;
  requestUnlock: (request: UnlockRequest) => Promise<UnlockAnswer>;
  onUnlocked?: (door: AdoptionDoor) => void;
}): Promise<SqliteDriver> {
  const { dbPath, custody, keyStore, requestUnlock, onUnlocked } = opts;

  mkdirSync(dirname(dbPath), { recursive: true });

  if (custody === "plaintext") return openPlaintextStore(dbPath);

  const recoveryPath = recoverySidecarPath(dbPath);

  let dbKey = await keyStore.getSecret(DATABASE_KEY);
  let door: AdoptionDoor | undefined;

  if (dbKey === undefined && storeFileState(dbPath) === "encrypted") {
    // The keychain is gone but the file survives: the sidecars are the only way
    // in, since the db-key lives nowhere inside the store it opens.
    const password = readSidecar(passwordSidecarPath(dbPath));
    const phrase = readSidecar(recoveryPath);
    if (password === undefined && phrase === undefined) {
      throw new Error(
        "The database is encrypted but this device's key is missing, and no " +
          "recovery file was found. The data cannot be opened on this device.",
      );
    }

    const unlocked = await unlockStore({ password, phrase }, requestUnlock);
    dbKey = unlocked.dbKey;
    door = unlocked.door;
    onUnlocked?.(door);
    await keyStore.setSecret(DATABASE_KEY, dbKey);
  }

  // Mints a key only for a store that does not exist yet.
  if (dbKey === undefined) dbKey = await ensureDatabaseKey(keyStore);

  if (storeFileState(dbPath) === "plaintext") {
    throw new Error(
      "The store for this account is unencrypted. It was not converted when the " +
        "account was created, so it cannot be opened as an encrypted store.",
    );
  }
  const db = openEncryptedDatabase(dbPath, dbKey);

  await resealRecoveryDoor({
    keyStore,
    dbKey,
    door,
    writeRecovery: (bytes) => writeSidecar(recoveryPath, bytes),
  });

  return encryptedSqliteDriver(db);
}

/** The Unauthenticated store: plaintext, no keys, no sidecar. */
function openPlaintextStore(dbPath: string): SqliteDriver {
  if (storeFileState(dbPath) === "encrypted") {
    throw new Error(
      "The store at this location is encrypted, but no account was found for " +
        "it. Its account may be missing from this device's roster.",
    );
  }
  // Encryption is decided at open time, never in the shared driver wrapper.

  return encryptedSqliteDriver(new Database(dbPath));
}
