import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { createInMemoryKeyStore, generateKey } from "@leapsake/crypto";
import { runMigrations } from "@leapsake/core";
import { createPeopleRepo } from "@leapsake/data";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  convertStoreToEncrypted,
  destroyStoreFiles,
  rekeyStore,
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
 *
 * The second half of the file covers the **encrypted → encrypted** door,
 * `rekeyStore` — the file-level move behind merging a local-only account into a
 * synced one (`encryption/model.md` §7.2.2). Same machinery, a different
 * source custody, and one extra thing to prove: the copy never lands in the clear.
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

/**
 * A realistic store with the true app schema and a row in it — Unauthenticated
 * when no key is given, Authenticated (encrypted under `key`) when one is. Both
 * go through the production open path, so the schema is the real one rather than
 * a hand-rolled table the conversion would find suspiciously easy.
 */
async function seedOpenStore(key?: Uint8Array): Promise<void> {
  const keyStore = createInMemoryKeyStore();
  if (key !== undefined) await keyStore.setSecret("db-key", key);
  const driver = await openAppDatabase({
    dbPath: fromPath,
    custody: key === undefined ? "plaintext" : "encrypted",
    keyStore,
    requestUnlock: never,
  });
  await runMigrations(driver);
  await createPeopleRepo(driver).create({
    firstName: "Mary",
    lastName: "Bailey",
  });
  await driver.close?.();
}

/** The people in a store, read through the production encrypted open path. */
async function readPeople(
  path: string,
  key: Uint8Array,
): Promise<(string | null)[]> {
  const driver = encryptedSqliteDriver(openEncryptedDatabase(path, key));
  const people = await createPeopleRepo(driver).list();
  await driver.close?.();
  return people.map((p) => p.firstName);
}

describe("convertStoreToEncrypted", () => {
  it("produces an encrypted store holding the same data", async () => {
    await seedOpenStore();
    const key = generateKey();

    convertStoreToEncrypted({ fromPath, toPath, key });

    expect(storeFileState(toPath)).toBe("encrypted");
    const driver = encryptedSqliteDriver(openEncryptedDatabase(toPath, key));
    const people = await createPeopleRepo(driver).list();
    expect(people.map((p) => p.firstName)).toEqual(["Mary"]);
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

    destroyStoreFiles(fromPath);
    expect(existsSync(fromPath)).toBe(false);
    expect(existsSync(`${fromPath}-wal`)).toBe(false);
    expect(existsSync(`${fromPath}-shm`)).toBe(false);
  });

  // Encrypted sources are no longer refused by the *module* — `rekeyStore` is the
  // door for them. This case stays because feeding one to the plaintext converter
  // is still a caller bug, and the two doors must not blur into one.
  it("refuses an encrypted source — re-keying is rekeyStore's job", async () => {
    await seedOpenStore();
    const key = generateKey();
    convertStoreToEncrypted({ fromPath, toPath, key });

    const secondPath = join(dir, "stores", "acct-2", "leapsake.db");
    expect(() =>
      convertStoreToEncrypted({ fromPath: toPath, toPath: secondPath, key }),
    ).toThrow(/not a plaintext database/);
    expect(storeFileState(secondPath)).toBe("absent");
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

/**
 * The encrypted → encrypted door. Its caller is the account merge: a device
 * holding a local-only account signs into one it already has, and its store has
 * to move to the new account's folder rather than be thrown away.
 */
describe("rekeyStore", () => {
  let fromKey: Uint8Array;
  let toKey: Uint8Array;

  beforeEach(() => {
    fromKey = generateKey();
    toKey = generateKey();
  });

  it("produces an encrypted store under the new key holding the same data", async () => {
    await seedOpenStore(fromKey);

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(storeFileState(toPath)).toBe("encrypted");
    expect(await readPeople(toPath, toKey)).toEqual(["Mary"]);
  });

  // The one assertion that separates a re-key from a byte copy. Without it every
  // other case here would pass against `copyFileSync`.
  it("writes a destination the old key cannot open", async () => {
    await seedOpenStore(fromKey);

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(() => openEncryptedDatabase(toPath, fromKey)).toThrow(
      /wrong or missing key/,
    );
  });

  it("carries the migration watermark across", async () => {
    await seedOpenStore(fromKey);
    const before = readUserVersion(fromPath, fromKey);
    expect(before).toBeGreaterThan(0);

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(readUserVersion(toPath, toKey)).toBe(before);
  });

  // Readable is not the same as launchable, and the boot path pins the cipher —
  // so this is also what catches the destination being written under the wrong one.
  it("yields a store the boot path can reopen and migrate idempotently", async () => {
    await seedOpenStore(fromKey);
    rekeyStore({ fromPath, fromKey, toPath, toKey });

    const keyStore = createInMemoryKeyStore();
    await keyStore.setSecret("db-key", toKey);
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
    await seedOpenStore(fromKey);
    const before = countIndexes(fromPath, fromKey);
    expect(before).toBeGreaterThan(0);

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(countIndexes(toPath, toKey)).toBe(before);
  });

  // Stricter than the plaintext twin: here the source is an account's whole
  // store, so "still there" is not enough — it has to still open and still hold
  // the data, because it is what the merge falls back to if the roster write
  // never happens.
  it("leaves the original in place, openable, with its rows", async () => {
    await seedOpenStore(fromKey);

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(storeFileState(fromPath)).toBe("encrypted");
    expect(await readPeople(fromPath, fromKey)).toEqual(["Mary"]);
  });

  it("refuses a plaintext source", async () => {
    await seedOpenStore();

    expect(() => rekeyStore({ fromPath, fromKey, toPath, toKey })).toThrow(
      /not an encrypted database/,
    );
    expect(storeFileState(toPath)).toBe("absent");
  });

  // `storeFileState` reads sixteen bytes, so "encrypted" cannot mean "opens under
  // this key" — the open is the other half of the guard. The destination
  // assertion is what proves the open runs *before* the ATTACH creates anything.
  it("rejects a source that does not open under the supplied key", async () => {
    await seedOpenStore(fromKey);

    expect(() =>
      rekeyStore({ fromPath, fromKey: generateKey(), toPath, toKey }),
    ).toThrow(/wrong or missing key/);
    expect(storeFileState(toPath)).toBe("absent");
  });

  it("refuses to overwrite an existing destination", async () => {
    await seedOpenStore(fromKey);
    rekeyStore({ fromPath, fromKey, toPath, toKey });

    expect(() => rekeyStore({ fromPath, fromKey, toPath, toKey })).toThrow(
      /already exists at the destination/,
    );
  });

  it("leaves the original intact when the destination cannot be written", async () => {
    await seedOpenStore(fromKey);

    expect(() =>
      rekeyStore({
        fromPath,
        fromKey,
        toPath: join(dir, "nonexistent\0dir", "leapsake.db"),
        toKey,
      }),
    ).toThrow();

    expect(storeFileState(fromPath)).toBe("encrypted");
    expect(await readPeople(fromPath, fromKey)).toEqual(["Mary"]);
  });

  // The case the merge actually hits. The at-rest key is minted per *device*, not
  // per account, so moving one of this device's stores to another account's
  // folder re-homes it without changing its lock — and a guard written as if the
  // keys always differ would refuse the only caller there is.
  it("re-homes a store when the two keys are the same", async () => {
    await seedOpenStore(fromKey);

    rekeyStore({ fromPath, fromKey, toPath, toKey: fromKey });

    expect(storeFileState(toPath)).toBe("encrypted");
    expect(await readPeople(toPath, fromKey)).toEqual(["Mary"]);
  });

  /**
   * The property the whole ATTACH shape exists to preserve: decrypting to a
   * scratch file and re-encrypting it would be simpler and would put the user's
   * entire database on disk in the clear (`model.md` §7.2.1), where deleted bytes
   * linger in SSD free space long after the unlink.
   *
   * **What this can and cannot see.** The converter is synchronous, so nothing
   * can sample the filesystem mid-call; a file created *and* deleted inside it
   * leaves nothing to find. Both checks below are deterministic — they can miss
   * that one shape, never invent a failure. The rest of the defence is
   * structural: the re-key path never opens a bare handle, and
   * "writes a destination the old key cannot open" above is what would catch a
   * copy-then-rekey-in-place implementation.
   */
  it("never writes a plaintext file", async () => {
    await seedOpenStore(fromKey);
    const before = new Set(readdirSync(tmpdir()));

    rekeyStore({ fromPath, fromKey, toPath, toKey });

    // Nothing under the working tree is readable without a key. The destination
    // assertion keeps this honest: an empty sweep would otherwise pass whether
    // it walked the tree or failed to find it.
    const swept = filesUnder(dir);
    expect(swept).toContain(toPath);
    expect(swept.filter((f) => storeFileState(f) === "plaintext")).toEqual([]);

    // …and nothing was parked at the top of the OS temp directory. Only *files*
    // are considered: sibling suites create temp directories there, and vitest
    // runs test files in parallel, so counting new directories would flake on
    // work that has nothing to do with this call.
    const strays = readdirSync(tmpdir(), { withFileTypes: true })
      .filter((entry) => entry.isFile() && !before.has(entry.name))
      .map((entry) => join(tmpdir(), entry.name));
    expect(strays.filter((f) => storeFileState(f) === "plaintext")).toEqual([]);
  });
});

/** Open bare or keyed, depending on the store's custody. */
function openStore(path: string, key?: Uint8Array) {
  return key === undefined
    ? new Database(path)
    : openEncryptedDatabase(path, key);
}

function readUserVersion(path: string, key?: Uint8Array): number {
  const db = openStore(path, key);
  const [{ user_version: v }] = db.pragma("user_version", {
    simple: false,
  }) as { user_version: number }[];
  db.close();
  return v;
}

function countIndexes(path: string, key?: Uint8Array): number {
  const db = openStore(path, key);
  const [{ n }] = db
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { n: number }[];
  db.close();
  return n;
}

/** Every regular file under `root`, recursively. */
function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}
