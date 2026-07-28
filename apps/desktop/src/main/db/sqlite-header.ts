import { closeSync, openSync, readSync, statSync } from "node:fs";

/** What is sitting at a store path, decided without opening a database. */
export type StoreFileState = "absent" | "empty" | "plaintext" | "encrypted";

/** The 16-byte magic every unencrypted SQLite file starts with. */
const SQLITE_MAGIC = "SQLite format 3";

/**
 * Classify the file at `path` by its first 16 bytes: an unencrypted SQLite
 * database starts with the literal `"SQLite format 3\0"`, while an encrypted
 * one's leading bytes are ciphertext and will not match.
 *
 * That distinction is what lets both boot branches refuse a store in the wrong
 * custody state (`model.md` §7.2) with a clear message, instead of failing deep
 * inside the first query with SQLite's misleading `file is not a database`.
 *
 * **`empty` is a real state, not a curiosity.** SQLite creates the file on open
 * but does not write the header until the first write, so a store that was opened
 * and never written is zero bytes — which matches *neither* magic. Folding that
 * into `encrypted` (as "not plaintext" would) sends an untouched Open store into
 * the recovery gate, so it gets its own answer and callers treat it as absent.
 *
 * Reads only the header rather than the whole file: these run on the boot path,
 * and a store can be large.
 */
export function storeFileState(path: string): StoreFileState {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return "absent";
  }
  if (size === 0) return "empty";

  const header = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString("latin1").startsWith(SQLITE_MAGIC)
    ? "plaintext"
    : "encrypted";
}

/** Whether `path` holds a readable, unencrypted SQLite database. */
export function isPlaintextSqlite(path: string): boolean {
  return storeFileState(path) === "plaintext";
}
