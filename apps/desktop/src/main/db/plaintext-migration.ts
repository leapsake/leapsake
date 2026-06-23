import { copyFileSync, existsSync, readFileSync } from "node:fs";
import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import { openEncryptedDatabase } from "./encrypted-sqlite-driver.js";

/**
 * One-time upgrade of a pre-Stage-2 **plaintext** `leapsake.db` to at-rest
 * encryption. Existing V1/V2 installs have an unencrypted file the encrypted
 * engine cannot open directly, so on the first encrypted launch we re-key it in
 * place under the device's whole-DB key.
 *
 * Runs *before* {@link openEncryptedDatabase} in the desktop bootstrap. It is:
 * - **idempotent** — a no-op once the file is already ciphertext;
 * - **skipped on fresh installs** — no file means the encrypted open creates a new
 *   encrypted DB from scratch;
 * - **non-destructive** — the original plaintext file is copied to
 *   `<db>.plaintext.bak` before re-keying, kept until the user is confident.
 */
export function migratePlaintextDatabase(
  dbPath: string,
  key: Uint8Array,
): void {
  if (!existsSync(dbPath) || !isPlaintextSqlite(dbPath)) return;

  copyFileSync(dbPath, `${dbPath}.plaintext.bak`);

  // Open the plaintext file (no key), then PRAGMA rekey encrypts it in place.
  const db = new Database(dbPath);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`rekey="${rawKeyLiteral(key)}"`);
  db.close();

  // Fail loudly if the re-key did not yield a key-openable encrypted DB, before
  // the bootstrap proceeds to use it.
  openEncryptedDatabase(dbPath, key).close();
}

/**
 * Whether `path` is an unencrypted SQLite file: its first 16 bytes are the literal
 * `"SQLite format 3\0"` header. An encrypted database's leading bytes are
 * ciphertext and will not match, so this cleanly distinguishes "needs migration"
 * from "already encrypted".
 */
export function isPlaintextSqlite(path: string): boolean {
  const header = readFileSync(path).subarray(0, 16).toString("latin1");
  return header.startsWith("SQLite format 3");
}
