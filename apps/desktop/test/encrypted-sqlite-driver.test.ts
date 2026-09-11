import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey } from "@leapsake/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encryptedSqliteDriver,
  openEncryptedDatabase,
} from "../src/main/db/encrypted-sqlite-driver.js";

/** Whether a file on disk is an unencrypted SQLite database (the 16-byte header). */
function isPlaintextSqlite(path: string): boolean {
  return readFileSync(path)
    .subarray(0, 16)
    .toString("latin1")
    .startsWith("SQLite format 3");
}

describe("encryptedSqliteDriver", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "leapsake-enc-"));
    dbPath = join(dir, "leapsake.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips rows through the SqliteDriver port", async () => {
    const key = generateKey();
    const driver = encryptedSqliteDriver(openEncryptedDatabase(dbPath, key));

    await driver.exec("CREATE TABLE person(id TEXT PRIMARY KEY, name TEXT)");
    await driver.transaction(async () => {
      await driver.run("INSERT INTO person VALUES (?, ?)", ["1", "Mary"]);
      await driver.run("INSERT INTO person VALUES (?, ?)", ["2", "Henry"]);
    });

    expect(
      await driver.get("SELECT name FROM person WHERE id = ?", ["1"]),
    ).toEqual({ name: "Mary" });
    expect(await driver.all("SELECT name FROM person ORDER BY id")).toEqual([
      { name: "Mary" },
      { name: "Henry" },
    ]);
  });

  it("binds Uint8Array as BLOB and returns it readable (key-wrap ciphertext shape)", async () => {
    const key = generateKey();
    const driver = encryptedSqliteDriver(openEncryptedDatabase(dbPath, key));
    const blob = new Uint8Array([1, 2, 3, 250]);

    await driver.exec(
      "CREATE TABLE k(id INTEGER PRIMARY KEY, ciphertext BLOB)",
    );
    await driver.run("INSERT INTO k(ciphertext) VALUES (?)", [blob]);

    const row = await driver.get<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM k WHERE id = 1",
    );
    expect(Uint8Array.from(row!.ciphertext)).toEqual(blob);
  });

  it("writes the file as ciphertext, not a readable SQLite file", async () => {
    const key = generateKey();
    const db = openEncryptedDatabase(dbPath, key);
    encryptedSqliteDriver(db); // schema write forces a flush to disk
    db.exec("CREATE TABLE t(x)");
    db.close();

    expect(isPlaintextSqlite(dbPath)).toBe(false);
  });

  it("reopens with the right key and rejects a wrong key", async () => {
    const key = generateKey();
    const db = openEncryptedDatabase(dbPath, key);
    db.exec("CREATE TABLE t(x)");
    db.prepare("INSERT INTO t VALUES (1)").run();
    db.close();

    const reopened = openEncryptedDatabase(dbPath, key);
    expect(reopened.prepare("SELECT count(*) AS c FROM t").get()).toEqual({
      c: 1,
    });
    reopened.close();

    expect(() => openEncryptedDatabase(dbPath, generateKey())).toThrow(
      /wrong or missing key/i,
    );
  });
});
