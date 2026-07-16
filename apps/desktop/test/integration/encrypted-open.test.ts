import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey } from "@leapsake/crypto";
import { describe, expect, it } from "vitest";
import { openEncryptedDatabase } from "../../src/main/db/encrypted-sqlite-driver.js";

/**
 * The wrong-key branch of the production open path — a *desktop* concern (the
 * `SqliteDriver` contract receives an already-open driver, so it never exercises
 * this), kept alongside the driver-contract coverage forcer so the whole driver
 * file stays at 100%. Opening an encrypted file under the wrong key must fail
 * *here*, at open, with a clear message — not later, mid-query.
 */
describe("openEncryptedDatabase", () => {
  it("throws a clear error when the key is wrong", () => {
    const dir = mkdtempSync(join(tmpdir(), "leapsake-open-"));
    const path = join(dir, "leapsake.db");
    try {
      const db = openEncryptedDatabase(path, generateKey());
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      db.close();

      // A different key can't decrypt page 1 → the forced `PRAGMA user_version`
      // read throws and is rewrapped as the clear open-time error.
      expect(() => openEncryptedDatabase(path, generateKey())).toThrow(
        /wrong or missing key/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
