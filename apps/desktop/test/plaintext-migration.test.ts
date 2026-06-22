import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { generateKey } from "@leapsake/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openEncryptedDatabase } from "../src/main/db/encrypted-sqlite-driver.js";
import { migratePlaintextDatabase } from "../src/main/db/plaintext-migration.js";

function isPlaintextSqlite(path: string): boolean {
  return readFileSync(path)
    .subarray(0, 16)
    .toString("latin1")
    .startsWith("SQLite format 3");
}

/** Seed a pre-Stage-2 plaintext leapsake.db (an unkeyed SQLite file) at `path`. */
function seedPlaintextDb(path: string): void {
  const db = new Database(path);
  db.exec("CREATE TABLE person(id TEXT PRIMARY KEY, name TEXT)");
  db.prepare("INSERT INTO person VALUES (?, ?)").run("1", "Ada");
  db.prepare("INSERT INTO person VALUES (?, ?)").run("2", "Grace");
  db.close();
}

describe("migratePlaintextDatabase", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-mig-"));
    dbPath = join(dir, "leapsake.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("re-keys a plaintext DB in place, preserving data and keeping a backup", () => {
    seedPlaintextDb(dbPath);
    expect(isPlaintextSqlite(dbPath)).toBe(true);

    const key = generateKey();
    migratePlaintextDatabase(dbPath, key);

    // File is now ciphertext, with the original kept as a backup.
    expect(isPlaintextSqlite(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}.plaintext.bak`)).toBe(true);
    expect(isPlaintextSqlite(`${dbPath}.plaintext.bak`)).toBe(true);

    // Data survives and is readable only under the key.
    const db = openEncryptedDatabase(dbPath, key);
    expect(db.prepare("SELECT name FROM person ORDER BY id").all()).toEqual([
      { name: "Ada" },
      { name: "Grace" },
    ]);
    db.close();
    expect(() => openEncryptedDatabase(dbPath, generateKey())).toThrow();
  });

  it("is a no-op when the file is absent (fresh install)", () => {
    migratePlaintextDatabase(dbPath, generateKey());
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(`${dbPath}.plaintext.bak`)).toBe(false);
  });

  it("is idempotent once the DB is already encrypted", () => {
    const key = generateKey();
    seedPlaintextDb(dbPath);
    migratePlaintextDatabase(dbPath, key);
    rmSync(`${dbPath}.plaintext.bak`);

    // A second run sees ciphertext and does nothing — no new backup, data intact.
    migratePlaintextDatabase(dbPath, key);
    expect(existsSync(`${dbPath}.plaintext.bak`)).toBe(false);

    const db = openEncryptedDatabase(dbPath, key);
    expect(db.prepare("SELECT count(*) AS c FROM person").get()).toEqual({
      c: 2,
    });
    db.close();
  });
});
