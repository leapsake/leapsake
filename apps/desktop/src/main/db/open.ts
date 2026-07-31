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

/**
 * Which doors this store actually has, and the answer the user gave. The gate
 * offers only the doors that exist, so a store written before the password door
 * shipped simply behaves as it always did.
 */
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
 * Open the app's at-rest database in the custody state this launch is actually in
 * (`model.md` §7.2 — *encryption follows custody*).
 *
 * **Unauthenticated** (`custody: "plaintext"`) — no account exists, so **no key exists**: mint
 * nothing, touch the keychain not at all, and open the file as plaintext. This is
 * every fresh install until the user creates an account. A key held only by the OS
 * keychain guards little that platform disk encryption doesn't already cover,
 * while creating a real data-loss path, so we no longer create one.
 *
 * **Authenticated** (`custody: "encrypted"`) — an account exists, so every key exists
 * and the file is ciphertext, with the recovery escape hatch (§6) intact. Three
 * cases:
 *
 * 1. **Enclave holds the key** (every normal launch) — read it and open.
 * 2. **No enclave key and no file** — mint the key and create the store encrypted
 *    (an Authenticated slot with nothing in it yet; §7.1).
 * 3. **No enclave key, but an encrypted file *and* at least one sidecar exist**
 *    (the OS keychain was wiped while the data survived) — prompt for a secret,
 *    unwrap the db-key from the matching sidecar, restore it to the enclave, then
 *    open. This is the only way back, because the db-key deliberately lives
 *    nowhere inside the (unopenable) encrypted DB.
 *
 * Case 3 has **two doors** (§7.5 Phase 0.5), and the password is the primary one:
 * someone who remembers their password should never be sent hunting for 24 words
 * they may never have written down. The phrase is the forgot-password backstop.
 * Only the doors whose sidecars exist are offered, so a store written before the
 * password door shipped still behaves exactly as it did.
 *
 * `requestUnlock` is injected (the caller owns the UI); it is told which doors
 * exist and the previous attempt's error, and returns the secret to try. The DB
 * mechanics here are fully unit-testable without that UI.
 *
 * `onUnlocked` is the other half of case 3, and only fires there. A door unlock
 * means the keychain was lost, which means this device's *master* key is gone too —
 * so the caller must re-adopt the account's before anything reads it
 * (`adoptAccountMasterKey`, custody slice 9). It hands over the key material the
 * unlock already derived rather than the typed secret: the password sidecar is
 * sealed under the account's own salt, so the KEK that just opened the db-key is
 * the same one that unwraps the master key, and re-deriving would mean a second
 * Argon2id pass for nothing. The repair itself cannot happen here — there is no
 * open database until well below this loop, let alone a migrated one.
 */
export async function openAppDatabase(opts: {
  dbPath: string;
  custody: "plaintext" | "encrypted";
  keyStore: KeyStore;
  requestUnlock: (request: UnlockRequest) => Promise<UnlockAnswer>;
  onUnlocked?: (door: AdoptionDoor) => void;
}): Promise<SqliteDriver> {
  const { dbPath, custody, keyStore, requestUnlock, onUnlocked } = opts;

  // Stores now live in per-account directories (§7.4), which will not exist on a
  // first launch into either state.
  mkdirSync(dirname(dbPath), { recursive: true });

  if (custody === "plaintext") return openPlaintextStore(dbPath);

  const recoveryPath = recoverySidecarPath(dbPath);

  let dbKey = await keyStore.getSecret(DATABASE_KEY);
  let recoveryKey: Uint8Array | undefined;

  if (dbKey === undefined && storeFileState(dbPath) === "encrypted") {
    // Case 3: the enclave is gone but the encrypted file survives. The sidecars
    // are the only ways in — without either there is nothing to try.
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

  // Refresh the recovery sidecar to the *current* enclave recovery key. On a
  // phrase unlock we already hold it (restore it to the enclave); otherwise read
  // it. Rewriting on every launch — not only when missing — keeps the sidecar in
  // step if the recovery key was adopted later (e.g. after recovering an account),
  // so it always opens under the phrase the user actually holds.
  //
  // **Read, never mint.** This used to call `ensureRecoveryKey`, which was safe
  // only while the phrase was the sole door: every path in had the recovery key.
  // A *password* unlock does not — the recovery key stays in the enclave it was
  // wiped from, and nothing local can recover it — so minting here would generate
  // a fresh key, re-seal the sidecar under it, and **silently invalidate the 24
  // words the user wrote down**. Nothing needs minting at boot in any case:
  // account creation, join, and recovery each establish the recovery key before a
  // store is ever opened.
  if (recoveryKey === undefined) recoveryKey = await readRecoveryKey(keyStore);
  else await keyStore.setSecret(RECOVERY_KEY, recoveryKey);
  if (recoveryKey !== undefined) {
    writeSidecar(recoveryPath, sealDbKeyForRecovery(dbKey, recoveryKey));
  }

  return encryptedSqliteDriver(db);
}

/**
 * The Unauthenticated store: plaintext, no keys, no sidecar.
 *
 * The guard matters more than it looks. If a file is sitting at the Unauthenticated store's
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
