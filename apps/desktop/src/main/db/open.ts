import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import {
  DATABASE_KEY,
  type KeyStore,
  RECOVERY_KEY,
  decodeRecoveryPhrase,
  ensureDatabaseKey,
  openDbKeyFromRecovery,
  openPasswordSidecar,
  readRecoveryKey,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import type { AdoptionDoor } from "@leapsake/core";
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

/** What the gate should offer: the doors whose sidecars exist. */
export interface UnlockRequest {
  /** The previous attempt's failure, if any, so the gate can re-prompt. */
  error?: string;
  doors: { password: boolean; phrase: boolean };
}

/** The secret the user typed, and which door they typed it into. */
export interface UnlockAnswer {
  door: "password" | "phrase";
  secret: string;
}

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
  let recoveryKey: Uint8Array | undefined;

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

    let error: string | undefined;
    for (;;) {
      const answer = await requestUnlock({
        error,
        doors: {
          password: password !== undefined,
          phrase: phrase !== undefined,
        },
      });
      try {
        if (answer.door === "password" && password !== undefined) {
          const opened = openPasswordSidecar(password, answer.secret);
          dbKey = opened.dbKey;
          // The KEK that opened the db-key also unwraps the master key, which
          // the caller must re-adopt: a door unlock means a lost keychain.
          onUnlocked?.({
            kind: "password",
            kek: opened.kek,
            authVerifier: opened.authVerifier,
          });
        } else if (answer.door === "phrase" && phrase !== undefined) {
          // Hold the recovery key: it is also this device's enclave copy, which
          // the refresh below restores. A password unlock cannot recover it.
          recoveryKey = decodeRecoveryPhrase(answer.secret);
          dbKey = openDbKeyFromRecovery(phrase, recoveryKey);
          onUnlocked?.({ kind: "recovery", recoveryKey });
        } else {
          throw new Error("That door is not available on this device.");
        }
        break;
      } catch {
        recoveryKey = undefined;
        error =
          answer.door === "password"
            ? "That password doesn't open this database."
            : "That recovery phrase doesn't open this database.";
      }
    }
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

  // Reseal the recovery sidecar every launch, so it opens under the phrase the
  // user holds. Read, never mint: desktop README → *Invariants*.
  if (recoveryKey === undefined) recoveryKey = await readRecoveryKey(keyStore);
  else await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
  if (recoveryKey !== undefined) {
    writeSidecar(recoveryPath, sealDbKeyForRecovery(dbKey, recoveryKey));
  }

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
