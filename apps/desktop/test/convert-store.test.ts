import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { createInMemoryKeyStore, generateKey } from "@leapsake/crypto";
import { runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  convertStoreToEncrypted,
  destroyPlaintextStore,
} from "../src/main/db/convert-store.js";
import {
  encryptedSqliteDriver,
  openEncryptedDatabase,
} from "../src/main/db/encrypted-sqlite-driver.js";
import { storeFileState } from "../src/main/db/sqlite-header.js";
import { openAppDatabase } from "../src/main/db/open.js";

/**
 * The plaintext → encrypted conversion (`model.md` §8.1) — the one irreversible
 * step of account creation. These pin the three details that are easy to get
 * wrong and expensive to discover late: the real schema survives, the migration
 * watermark comes across, and the plaintext original is gone afterwards.
 */
const never = () => Promise.reject(new Error("unexpected recovery prompt"));

let dir: string;
let fromPath: string;
let toPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "leapsake-convert-"));
  fromPath = join(dir, "stores", "local", "leapsake.db");
  toPath = join(dir, "stores", "acct-1", "leapsake.db");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A realistic Unauthenticated store: the true app schema, with a row in it. */
async function seedOpenStore(): Promise<void> {
  const driver = await openAppDatabase({
    dbPath: fromPath,
    custody: "plaintext",
    keyStore: createInMemoryKeyStore(),
    requestUnlock: never,
  });
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Ada",
    lastName: "Lovelace",
  });
  await driver.close?.();
}

describe("convertStoreToEncrypted", () => {
  it("produces an encrypted store holding the same data", async () => {
    await seedOpenStore();
    const key = generateKey();

    convertStoreToEncrypted({ fromPath, toPath, key });

    expect(storeFileState(toPath)).toBe("encrypted");
    const driver = encryptedSqliteDriver(openEncryptedDatabase(toPath, key));
    const people = await createPeopleRepo(driver).list();
    expect(people.map((p) => p.firstName)).toEqual(["Ada"]);
    await driver.close?.();
  });

  // The migration runner keys off `user_version`, and ATTACH does not copy it.
  // Losing it sends the next boot through every migration again, against tables
  // that already exist — so this is the difference between a working store and
  // one that throws on launch.
  it("carries the migration watermark across", async () => {
    await seedOpenStore();
    const key = generateKey();
    const before = readUserVersion(fromPath);
    expect(before).toBeGreaterThan(0);

    convertStoreToEncrypted({ fromPath, toPath, key });

    const db = openEncryptedDatabase(toPath, key);
    const [{ user_version: after }] = db.pragma("user_version", {
      simple: false,
    }) as { user_version: number }[];
    db.close();
    expect(after).toBe(before);
  });

  // A converted store must be *launchable*, not merely readable: running the
  // migrations again is exactly what the next boot does.
  it("yields a store the boot path can reopen and migrate idempotently", async () => {
    await seedOpenStore();
    const key = generateKey();
    convertStoreToEncrypted({ fromPath, toPath, key });

    const keyStore = createInMemoryKeyStore();
    await keyStore.setSecret("db-key", key);
    const driver = await openAppDatabase({
      dbPath: toPath,
      custody: "encrypted",
      keyStore,
      requestUnlock: never,
    });
    await runMigrations(driver); // must be a no-op, not a re-run
    expect((await createPeopleRepo(driver).list()).length).toBe(1);
    await driver.close?.();
  });

  it("preserves indexes, not just tables and rows", async () => {
    await seedOpenStore();
    const key = generateKey();
    const before = countIndexes(fromPath);
    expect(before).toBeGreaterThan(0);

    convertStoreToEncrypted({ fromPath, toPath, key });

    const db = openEncryptedDatabase(toPath, key);
    const [{ n }] = db
      .prepare(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { n: number }[];
    db.close();
    expect(n).toBe(before);
  });

  // The original deliberately outlives the conversion: it is the only copy until
  // the roster names the replacement, so deleting it here would open the one
  // window in which a crash loses data.
  it("leaves the original in place — destroying it is a separate step", async () => {
    await seedOpenStore();
    convertStoreToEncrypted({ fromPath, toPath, key: generateKey() });
    expect(storeFileState(fromPath)).toBe("plaintext");

    destroyPlaintextStore(fromPath);
    expect(existsSync(fromPath)).toBe(false);
    expect(existsSync(`${fromPath}-wal`)).toBe(false);
    expect(existsSync(`${fromPath}-shm`)).toBe(false);
  });

  it("refuses a source that is not plaintext", async () => {
    await seedOpenStore();
    const key = generateKey();
    convertStoreToEncrypted({ fromPath, toPath, key });

    // The (now encrypted) result must not be convertible again.
    expect(() =>
      convertStoreToEncrypted({
        fromPath: toPath,
        toPath: join(dir, "stores", "acct-2", "leapsake.db"),
        key,
      }),
    ).toThrow(/not a plaintext database/);
  });

  it("refuses to overwrite an existing destination", async () => {
    await seedOpenStore();
    const key = generateKey();
    convertStoreToEncrypted({ fromPath, toPath, key });

    // The source is still there, so a second run is a genuine retry — and must
    // refuse rather than clobber the store it already produced.
    expect(() => convertStoreToEncrypted({ fromPath, toPath, key })).toThrow(
      /already exists at the destination/,
    );
  });

  // The original is the only copy until the result is proven openable, so a
  // failure must not have destroyed it.
  it("leaves the original intact when the destination cannot be written", async () => {
    await seedOpenStore();
    expect(() =>
      convertStoreToEncrypted({
        fromPath,
        toPath: join(dir, "nonexistent\0dir", "leapsake.db"),
        key: generateKey(),
      }),
    ).toThrow();
    expect(storeFileState(fromPath)).toBe("plaintext");
  });
});

function readUserVersion(path: string): number {
  const db = new Database(path);
  const [{ user_version: v }] = db.pragma("user_version", {
    simple: false,
  }) as { user_version: number }[];
  db.close();
  return v;
}

function countIndexes(path: string): number {
  const db = new Database(path);
  const [{ n }] = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { n: number }[];
  db.close();
  return n;
}
