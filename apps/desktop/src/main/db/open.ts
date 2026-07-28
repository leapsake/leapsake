import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
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
import { storeFileState } from "./sqlite-header.js";

/**
 * Open the app's at-rest database in the custody state this launch is actually in
 * (`model.md` §7.2 — *encryption follows custody*).
 *
 * **Open** (`custody: "open"`) — no account exists, so **no key exists**: mint
 * nothing, touch the keychain not at all, and open the file as plaintext. This is
 * every fresh install until the user creates an account. A key held only by the OS
 * keychain guards little that platform disk encryption doesn't already cover,
 * while creating a real data-loss path, so we no longer create one.
 *
 * **Protected** (`custody: "protected"`) — an account exists, so every key exists
 * and the file is ciphertext, with the recovery escape hatch (§6) intact. Three
 * cases:
 *
 * 1. **Enclave holds the key** (every normal launch) — read it and open.
 * 2. **No enclave key and no file** — mint the key and create the store encrypted
 *    (a device joining an existing account, §7.1: encrypted from byte one).
 * 3. **No enclave key, but an encrypted file *and* its recovery sidecar exist**
 *    (the OS keychain was wiped while the data survived) — prompt for the recovery
 *    phrase, unwrap the db-key from the sidecar, restore it (and the recovery key)
 *    to the enclave, then open. This is the only way back, because the db-key
 *    deliberately lives nowhere inside the (unopenable) encrypted DB.
 *
 * On every successful Protected open it also ensures a recovery key exists in the
 * enclave and that the `<db>.recovery` sidecar is present.
 *
 * `requestRecoveryPhrase` is injected (the caller owns the UI); it is given the
 * previous attempt's error, if any, and returns the raw phrase to try. The DB
 * mechanics here are fully unit-testable without that UI.
 */
export async function openAppDatabase(opts: {
  dbPath: string;
  custody: "open" | "protected";
  keyStore: KeyStore;
  requestRecoveryPhrase: (ctx: { error?: string }) => Promise<string>;
}): Promise<SqliteDriver> {
  const { dbPath, custody, keyStore, requestRecoveryPhrase } = opts;

  // Stores now live in per-account directories (§7.4), which will not exist on a
  // first launch into either state.
  mkdirSync(dirname(dbPath), { recursive: true });

  if (custody === "open") return openPlaintextStore(dbPath);

  const sidecarPath = `${dbPath}.recovery`;

  let dbKey = await keyStore.getSecret(DATABASE_KEY);
  let recoveryKey: Uint8Array | undefined;

  if (dbKey === undefined && storeFileState(dbPath) === "encrypted") {
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

  // Cases 1 & 2: read the enclave key, minting one for a store that does not
  // exist yet.
  if (dbKey === undefined) dbKey = await ensureDatabaseKey(keyStore);

  // A *plaintext* file here is not something to silently fix. Until this change,
  // the boot path re-keyed it in place (the pre-Stage-2 upgrade, which also left a
  // `.plaintext.bak` §8.1 explicitly forbids). Under *encryption follows custody*
  // the only legitimate plaintext→encrypted conversion is the deliberate one at
  // account creation (§8.1), so anything else is a mismatch worth reporting.
  if (storeFileState(dbPath) === "plaintext") {
    throw new Error(
      "The store for this account is unencrypted. It was not converted when the " +
        "account was created, so it cannot be opened as an encrypted store.",
    );
  }
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

/**
 * The Open store: plaintext, no keys, no sidecar.
 *
 * The guard matters more than it looks. If a file is sitting at the Open store's
 * path and is *not* plaintext, something is wrong — most likely a store whose
 * account was lost from the roster — and the honest move is to refuse. Opening it
 * keyless would fail deep inside the first query with SQLite's misleading
 * "file is not a database"; worse, silently starting a *new* store beside it would
 * present the user with an empty app and no hint their data still exists.
 */
function openPlaintextStore(dbPath: string): SqliteDriver {
  if (storeFileState(dbPath) === "encrypted") {
    throw new Error(
      "The store at this location is encrypted, but no account was found for " +
        "it. Its account may be missing from this device's roster.",
    );
  }
  // No key applied — an ordinary SQLite file. The driver wrapper is shared with
  // the encrypted path; encryption is decided at open time, never in the wrapper.
  return encryptedSqliteDriver(new Database(dbPath));
}
