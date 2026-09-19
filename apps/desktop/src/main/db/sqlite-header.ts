import { closeSync, openSync, readSync, statSync } from "node:fs";

/** What is sitting at a store path, decided without opening a database. */
export type StoreFileState = "absent" | "empty" | "plaintext" | "encrypted";

/** The 16-byte magic every unencrypted SQLite file starts with. */
const SQLITE_MAGIC = "SQLite format 3";

/**
 * Classify a store by its first 16 bytes. `empty` is its own answer: SQLite
 * writes no header until the first write, and callers treat it as absent.
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
