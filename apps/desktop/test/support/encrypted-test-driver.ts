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

/**
 * A {@link SqliteDriver} over a throwaway, encrypted temp-file database — the
 * *production* engine (`better-sqlite3-multiple-ciphers`) the desktop main process
 * runs, built through the exact production open path
 * (`openEncryptedDatabase` → `encryptedSqliteDriver`). The integration suites live
 * here, in the app, because the app is where the driver is supplied to `core`; the
 * `packages/*` repos stay driver-free and treat it as a black box.
 *
 * The encrypted backend cannot key an in-memory DB ("Setting key not supported for
 * in-memory or temporary databases"), so each call gets its own temp directory.
 *
 * Call `cleanup()` in `afterEach` (once per database for multi-device suites); it
 * closes every handle this helper opened and removes the temp dir. `reopen()` opens
 * a second connection to the *same* file under the same key — for tests that assert
 * data survives a fresh driver/connection.
 */
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
      for (const db of handles) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
