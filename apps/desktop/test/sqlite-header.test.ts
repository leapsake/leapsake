import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey } from "@leapsake/crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  openEncryptedDatabase,
  encryptedSqliteDriver,
} from "../src/main/db/encrypted-sqlite-driver.js";
import { storeFileState } from "../src/main/db/sqlite-header.js";

/**
 * The boot path decides a store's custody state from its first 16 bytes, before
 * opening anything. Both refusals in `open.ts` key off this, so each state needs a
 * real file behind it — especially `empty`, which is the state that is easy to get
 * wrong (it matches neither magic, so "not plaintext" would misread it as
 * ciphertext and send an untouched store into the recovery gate).
 */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leapsake-header-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("storeFileState", () => {
  it("reports a missing file as absent", () => {
    expect(storeFileState(join(dir, "nope.db"))).toBe("absent");
  });

  it("reports a zero-byte file as empty, not encrypted", () => {
    const path = join(dir, "empty.db");
    writeFileSync(path, "");
    expect(storeFileState(path)).toBe("empty");
  });

  it("reports an unencrypted database as plaintext", async () => {
    const path = join(dir, "plain.db");
    const { default: Database } =
      await import("better-sqlite3-multiple-ciphers");
    const db = new Database(path);
    db.exec("CREATE TABLE t(x)"); // forces the header to disk
    db.close();
    expect(storeFileState(path)).toBe("plaintext");
  });

  it("reports a keyed database as encrypted", async () => {
    const path = join(dir, "sealed.db");
    const driver = encryptedSqliteDriver(
      openEncryptedDatabase(path, generateKey()),
    );
    await driver.exec("CREATE TABLE t(x)");
    await driver.close?.();
    expect(storeFileState(path)).toBe("encrypted");
  });

  // A file that is neither — the honest reading is "not something we can open
  // keyless", which is the same conclusion as ciphertext.
  it("reports arbitrary bytes as encrypted", () => {
    const path = join(dir, "garbage.db");
    writeFileSync(path, "not a database at all, just some bytes");
    expect(storeFileState(path)).toBe("encrypted");
  });
});
