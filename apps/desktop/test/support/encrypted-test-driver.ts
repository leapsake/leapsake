import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey } from "@leapsake/crypto";
import type { SqliteDriver } from "@leapsake/data";
import {
  type EncryptedDatabase,
  encryptedSqliteDriver,
  openEncryptedDatabase,
} from "../../src/main/db/encrypted-sqlite-driver.js";

/** A {@link SqliteDriver} over a throwaway encrypted temp file, opened through
 *  the production path; `reopen()` connects again to the same file and key. */
export function makeEncryptedTestDriver(): {
  driver: SqliteDriver;
  reopen: () => SqliteDriver;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "leapsake-test-"));
  const path = join(dir, "leapsake.db");
  const key = generateKey();
  const handles: EncryptedDatabase[] = [];

  const open = (): SqliteDriver => {
    const db = openEncryptedDatabase(path, key);
    handles.push(db);
    return encryptedSqliteDriver(db);
  };

  return {
    driver: open(),
    reopen: open,
    cleanup: () => {
      // Skips a handle a test already closed through the driver's `close()`.
      for (const db of handles) if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
