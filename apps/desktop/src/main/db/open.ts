import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  DATABASE_KEY,
  type KeyStore,
  RECOVERY_KEY,
  decodeRecoveryPhrase,
  ensureDatabaseKey,
  ensureRecoveryKey,
  openDbKeyFromRecovery,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import {
  encryptedSqliteDriver,
  openEncryptedDatabase,
} from "./encrypted-sqlite-driver.js";
import {
  isPlaintextSqlite,
  migratePlaintextDatabase,
} from "./plaintext-migration.js";

/**
 * Open the app's at-rest database, with the **recovery escape hatch** wired in
 * (encryption `model.md` §6, Stage 2). The whole-DB key normally comes from the OS
 * enclave; this resolves three cases:
 *
 * 1. **Enclave holds the key** (every normal launch) — read it and open.
 * 2. **No enclave key, no/plaintext file** (fresh install or a pre-Stage-2 upgrade)
 *    — mint the key and open (re-keying a plaintext file in place first).
 * 3. **No enclave key, but an encrypted file *and* its recovery sidecar exist**
 *    (the OS keychain was wiped while the data survived) — prompt for the recovery
 *    phrase, unwrap the db-key from the sidecar, restore it (and the recovery key)
 *    to the enclave, then open. This is the only way back, because the db-key
 *    deliberately lives nowhere inside the (unopenable) encrypted DB.
 *
 * On every successful open it also ensures a recovery key exists in the enclave and
 * that the `<db>.recovery` sidecar is present — so existing Stage-2 installs (which
 * predate this feature) gain a sidecar on their next launch, and the user can
 * reveal their phrase from Settings.
 *
 * `requestRecoveryPhrase` is injected (the caller owns the UI); it is given the
 * previous attempt's error, if any, and returns the raw phrase to try. The DB
 * mechanics here are fully unit-testable without that UI.
 */
export async function openAppDatabase(opts: {
  dbPath: string;
  keyStore: KeyStore;
  requestRecoveryPhrase: (ctx: { error?: string }) => Promise<string>;
}): Promise<SqliteDriver> {
  const { dbPath, keyStore, requestRecoveryPhrase } = opts;
  const sidecarPath = `${dbPath}.recovery`;

  let dbKey = await keyStore.getSecret(DATABASE_KEY);
  let recoveryKey: Uint8Array | undefined;

  if (dbKey === undefined && isEncryptedDatabase(dbPath)) {
    // Case 3: the enclave is gone but the encrypted file survives. We can only
    // reopen it via the recovery sidecar — without one there is no way in.
    if (!existsSync(sidecarPath)) {
      throw new Error(
        "The database is encrypted but this device's key is missing, and no " +
          "recovery file was found. The data cannot be opened on this device.",
      );
    }
    const sidecar = Uint8Array.from(readFileSync(sidecarPath));
    let error: string | undefined;
    for (;;) {
      const phrase = await requestRecoveryPhrase({ error });
      try {
        recoveryKey = decodeRecoveryPhrase(phrase);
        dbKey = openDbKeyFromRecovery(sidecar, recoveryKey);
        break;
      } catch {
        recoveryKey = undefined;
        error = "That recovery phrase doesn't open this database.";
      }
    }
    await keyStore.setSecret(DATABASE_KEY, dbKey);
  }

  // Cases 1 & 2: read the enclave key, minting one on a fresh/plaintext launch.
  if (dbKey === undefined) dbKey = await ensureDatabaseKey(keyStore);

  migratePlaintextDatabase(dbPath, dbKey);
  const db = openEncryptedDatabase(dbPath, dbKey);

  // Refresh the recovery sidecar to the *current* enclave recovery key on every
  // launch. On a phrase recovery we already hold the recovery key (restore it);
  // otherwise read/mint it. Always (re)writing — not just when missing — keeps the
  // sidecar in step if the recovery key was later adopted (e.g. after recovering
  // an account), so it always opens under the phrase the user actually holds.
  if (recoveryKey === undefined)
    recoveryKey = await ensureRecoveryKey(keyStore);
  else await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
  writeFileSync(sidecarPath, sealDbKeyForRecovery(dbKey, recoveryKey));

  return encryptedSqliteDriver(db);
}

/** Whether `path` is an existing, already-encrypted database (not plaintext). */
function isEncryptedDatabase(path: string): boolean {
  return existsSync(path) && !isPlaintextSqlite(path);
}
