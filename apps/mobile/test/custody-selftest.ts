import * as SQLite from "expo-sqlite";
import {
  ALG,
  DATABASE_KEY,
  KDF_ALG,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  generateKey,
  openDbKeyFromRecovery,
  rawKeyLiteral,
  sealDbKeyForRecovery,
  wrapKey,
} from "@leapsake/crypto";
import {
  adoptAccountMasterKey,
  adoptRecoveryKey,
  ensureDeviceMasterKey,
  establishKeySession,
} from "@leapsake/core";
import {
  createAccountRepo,
  createKeyWrapRepo,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import type { TestApi } from "@leapsake/data/testing";
import {
  convertStoreToEncrypted,
  destroyStoreFiles,
  storeState,
} from "../db/convert-store";
import { accountDoors, doorsPath } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";

// On-device proof of the expo-sqlite behaviours custody rests on; see
// `apps/mobile/README.md` → _The custody self-test_.

/** A throwaway database name, unique per case. */
function scratchName(label: string): string {
  return `custody-${label}-${crypto.randomUUID()}.db`;
}

/** Absolute path in expo-sqlite's directory, since `ATTACH` resolves a
 *  relative path against the process CWD. */
function scratchPath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}

/** Deletes a scratch database, tolerating "not found", so cleanup never
 *  masks the failure that caused it. */
async function discard(name: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch {
    // never created, or already gone
  }
}

/** Whether `fn` rejects. */
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

export function runCustodySelfTest(t: TestApi): void {
  const { describe, it, expect } = t;

  describe("custody: expo-sqlite SQLCipher behavior", () => {
    // A stock SQLite also opens keyless, so without this the plaintext cases
    // would prove nothing about the shipped engine.
    it("is a SQLCipher build", async () => {
      const name = scratchName("version");
      const db = await SQLite.openDatabaseAsync(name);
      try {
        const row = await db.getFirstAsync<{ cipher_version: string }>(
          "PRAGMA cipher_version",
        );
        expect(typeof row?.cipher_version === "string").toBe(true);
        expect((row?.cipher_version ?? "").length > 0).toBe(true);
      } finally {
        await db.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    it("creates and reads a plaintext database when no key is supplied", async () => {
      const name = scratchName("open");
      const db = await SQLite.openDatabaseAsync(name);
      try {
        await db.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
        await db.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "open");
        const row = await db.getFirstAsync<{ v: string }>(
          "SELECT v FROM t WHERE id = 1",
        );
        expect(row?.v).toBe("open");
      } finally {
        await db.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // Only a second connection proves the file plaintext: one session could be
    // decrypting under an implicit key.
    it("reopens a keyless database keyless, across connections", async () => {
      const name = scratchName("reopen");
      const first = await SQLite.openDatabaseAsync(name);
      await first.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      await first.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "persisted");
      await first.closeAsync();

      const second = await SQLite.openDatabaseAsync(name);
      try {
        const row = await second.getFirstAsync<{ v: string }>(
          "SELECT v FROM t WHERE id = 1",
        );
        expect(row?.v).toBe("persisted");
      } finally {
        await second.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // expo-sqlite shares a connection per name, so without `useNewConnection`
    // `storeState` would read an open store through its keyed handle.
    it("reports encrypted while a keyed handle is open", async () => {
      const name = scratchName("sharedconn");
      const keyed = await SQLite.openDatabaseAsync(name);
      await keyed.execAsync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`);
      await keyed.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      try {
        expect(await storeState(name)).toBe("encrypted");
      } finally {
        await keyed.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // The negative that makes the keyless cases above mean something.
    it("refuses a keyless read of a keyed database", async () => {
      const name = scratchName("keyed");
      const keyed = await SQLite.openDatabaseAsync(name);
      await keyed.execAsync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`);
      await keyed.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      await keyed.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "secret");
      await keyed.closeAsync();

      const keyless = await SQLite.openDatabaseAsync(name);
      try {
        expect(
          await rejects(() => keyless.getFirstAsync("SELECT v FROM t")),
        ).toBe(true);
      } finally {
        await keyless.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // Why `openExpoStore` follows `PRAGMA key` with a read: SQLCipher objects
    // to a wrong key only when page 1 is read.
    it("accepts a wrong key silently, and fails only on the first read", async () => {
      const name = scratchName("wrongkey");
      const keyed = await SQLite.openDatabaseAsync(name);
      await keyed.execAsync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`);
      await keyed.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      await keyed.closeAsync();

      const wrong = await SQLite.openDatabaseAsync(name);
      try {
        // Applying the wrong key reports nothing…
        expect(
          await rejects(() =>
            wrong.execAsync(`PRAGMA key = "${rawKeyLiteral(generateKey())}"`),
          ),
        ).toBe(false);
        // …and the page-1 read is what catches it.
        expect(
          await rejects(() => wrong.getFirstAsync("PRAGMA user_version")),
        ).toBe(true);
      } finally {
        await wrong.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });
  });

  describe("custody: per-account store paths (§7.4)", () => {
    // Mobile passes expo-sqlite a nested name, so whether one opens, with its
    // directory created, decides the per-account layout.
    it("opens a store under a nested, per-account name", async () => {
      const account = `acct-${crypto.randomUUID()}`;
      const name = `stores/${account}/leapsake.db`;
      const db = await SQLite.openDatabaseAsync(name);
      try {
        await db.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
        await db.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "nested");
        const row = await db.getFirstAsync<{ v: string }>(
          "SELECT v FROM t WHERE id = 1",
        );
        expect(row?.v).toBe("nested");
      } finally {
        await db.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // Two accounts must be genuinely separate databases, not one shared file.
    it("keeps two accounts' stores isolated", async () => {
      const one = `stores/acct-${crypto.randomUUID()}/leapsake.db`;
      const two = `stores/acct-${crypto.randomUUID()}/leapsake.db`;
      const dbOne = await SQLite.openDatabaseAsync(one);
      const dbTwo = await SQLite.openDatabaseAsync(two);
      try {
        await dbOne.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await dbOne.runAsync("INSERT INTO t (id) VALUES (1)");
        await dbTwo.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        const countTwo = await dbTwo.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM t",
        );
        expect(countTwo?.n).toBe(0);
      } finally {
        await dbOne.closeAsync();
        await dbTwo.closeAsync();
        await SQLite.deleteDatabaseAsync(one);
        await SQLite.deleteDatabaseAsync(two);
      }
    });

    // Forget account deletes by this nested name; a silent no-op would leave
    // "deleted" data in the sandbox.
    it("deletes a store by its nested, per-account name", async () => {
      const name = `stores/acct-${crypto.randomUUID()}/leapsake.db`;
      const db = await SQLite.openDatabaseAsync(name);
      await db.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      await db.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "secret");
      await db.closeAsync();

      await SQLite.deleteDatabaseAsync(name);

      // The same name must reopen empty, or a delete that did nothing would
      // still pass.
      const reopened = await SQLite.openDatabaseAsync(name);
      try {
        const table = await reopened.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't'",
        );
        expect(table).toBe(null);
      } finally {
        await reopened.closeAsync();
        await SQLite.deleteDatabaseAsync(name);
      }
    });

    // Forget account must take the account's doors: a door outliving its store
    // leaves "deleted" data openable.
    it("destroys one account's doors", async () => {
      const account = `acct-${crypto.randomUUID()}`;
      const doors = accountDoors(account);
      try {
        await doors.writePassword(Uint8Array.from([1, 2, 3]));
        await doors.writeRecovery(Uint8Array.from([4, 5, 6]));
        expect((await doors.readPassword())?.length).toBe(3);

        await doors.destroy();

        // Re-reading recreates an empty doors database, so a delete that did
        // nothing would fail here.
        expect(await doors.readPassword()).toBe(undefined);
        expect(await doors.readRecovery()).toBe(undefined);
      } finally {
        await doors.destroy();
      }
    });

    // A lost door is unrecoverable once that account's keychain is wiped, so
    // forgetting one account must leave another's intact.
    it("keeps one account's doors when another's are destroyed", async () => {
      const kept = accountDoors(`acct-${crypto.randomUUID()}`);
      const forgotten = accountDoors(`acct-${crypto.randomUUID()}`);
      try {
        await kept.writePassword(Uint8Array.from([1, 1, 1]));
        await forgotten.writePassword(Uint8Array.from([2, 2, 2]));

        await forgotten.destroy();

        expect(Array.from((await kept.readPassword()) ?? [])).toEqual([
          1, 1, 1,
        ]);
        expect(await forgotten.readPassword()).toBe(undefined);
      } finally {
        await kept.destroy();
        await forgotten.destroy();
      }
    });

    // Doors inside the store's directory make the case above structural, not
    // a matter of passing the right predicate.
    it("puts a doors database in its account's store directory", () => {
      const account = `acct-${crypto.randomUUID()}`;
      expect(doorsPath(account)).toBe(`stores/${account}/doors.db`);
    });
  });

  // The portable sequence at the end proves the engine supports the pattern;
  // this proves the shipped converter uses it correctly.
  describe("custody: the shipped store converter", () => {
    it("carries data, indexes and the migration watermark into a keyed store", async () => {
      const from = scratchName("prod-src");
      const to = `stores/acct-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(`
        CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE INDEX person_by_name ON person (name);
        PRAGMA user_version = 27;
      `);
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Mary",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });

        const target = await SQLite.openDatabaseAsync(to);
        await target.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const row = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(row?.name).toBe("Mary");
        const index = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'person_by_name'",
        );
        expect(index?.name).toBe("person_by_name");
        // Without this the next boot re-runs every migration on live tables.
        const version = await target.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        );
        expect(version?.user_version).toBe(27);
        await target.closeAsync();

        // The source stays until the roster names the replacement.
        const stillThere = await SQLite.openDatabaseAsync(from);
        const original = await stillThere.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(original?.name).toBe("Mary");
        await stillThere.closeAsync();
      } finally {
        // Tolerant, so a cleanup error never replaces the real failure.
        await discard(from);
        await discard(to);
      }
    });
  });

  // Account creation's file steps: the converted store refuses a keyless
  // read, and destroying the original leaves nothing plaintext.
  describe("custody: an account store's conversion", () => {
    it("ends up ciphertext, with the plaintext original destroyed", async () => {
      const from = scratchName("join-src");
      const to = `stores/joined-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(
        "CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Henry",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });
        // Without this the device keeps a plaintext copy of everything it
        // just encrypted.
        await destroyStoreFiles(from);

        // The paired negative — the target is only "encrypted" if a keyless
        // connection genuinely cannot read it.
        expect(
          await rejects(async () => {
            const keyless = await SQLite.openDatabaseAsync(to);
            try {
              return await keyless.getFirstAsync("SELECT name FROM person");
            } finally {
              await keyless.closeAsync();
            }
          }),
        ).toBe(true);

        const target = await SQLite.openDatabaseAsync(to);
        await target.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const row = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(row?.name).toBe("Henry");
        await target.closeAsync();

        // expo-sqlite creates on open, so the destroyed name reopens as a new,
        // empty database: "gone" reads as "no table".
        const reopened = await SQLite.openDatabaseAsync(from);
        const survivor = await reopened.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'person'",
        );
        expect(survivor?.n).toBe(0);
        await reopened.closeAsync();
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    // A crash before the roster entry strands an encrypted store; the retry
    // clears it first, since the overwrite guard refuses it.
    it("clears a stranded destination before converting again", async () => {
      const from = scratchName("retry-src");
      const to = `stores/retry-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(
        "CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Henry",
      );
      await source.closeAsync();

      try {
        // The leftover of an attempt that crashed before its roster entry.
        await convertStoreToEncrypted({ fromName: from, toName: to, key });

        await discard(to); // what the retry does when no roster entry claims it
        await convertStoreToEncrypted({ fromName: from, toName: to, key });

        const target = await SQLite.openDatabaseAsync(to);
        await target.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const count = await target.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM person",
        );
        expect(count?.n).toBe(1);
        await target.closeAsync();
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    // `storeState` stands in for desktop's header read, as expo-sqlite has no
    // raw file access; this proves it tells the three states apart.
    it("tells an empty, a plaintext and an encrypted store apart", async () => {
      const empty = scratchName("state-empty");
      const plain = scratchName("state-plain");
      const keyed = scratchName("state-keyed");
      try {
        expect(await storeState(empty)).toBe("empty");

        const plainDb = await SQLite.openDatabaseAsync(plain);
        await plainDb.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await plainDb.closeAsync();
        expect(await storeState(plain)).toBe("plaintext");

        const keyedDb = await SQLite.openDatabaseAsync(keyed);
        await keyedDb.execAsync(
          `PRAGMA key = "${rawKeyLiteral(generateKey())}"`,
        );
        await keyedDb.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY)");
        await keyedDb.closeAsync();
        expect(await storeState(keyed)).toBe("encrypted");
      } finally {
        await discard(empty);
        await discard(plain);
        await discard(keyed);
      }
    });

    it("refuses to convert into a store that already holds data", async () => {
      const from = scratchName("guard-src");
      const to = `stores/guard-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(
        "CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Mary",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });
        // The retry that would otherwise double every row.
        expect(
          await rejects(() =>
            convertStoreToEncrypted({ fromName: from, toName: to, key }),
          ),
        ).toBe(true);

        // …and it refused before writing: the first conversion's rows are
        // intact and not duplicated.
        const target = await SQLite.openDatabaseAsync(to);
        await target.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const count = await target.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM person",
        );
        expect(count?.n).toBe(1);
        await target.closeAsync();
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    it("refuses to convert a store that is already encrypted", async () => {
      const from = scratchName("guard-enc-src");
      const to = `stores/guard-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
      await source.execAsync("CREATE TABLE person (id INTEGER PRIMARY KEY)");
      await source.closeAsync();

      try {
        expect(
          await rejects(() =>
            convertStoreToEncrypted({ fromName: from, toName: to, key }),
          ),
        ).toBe(true);
      } finally {
        await discard(from);
        await discard(to);
      }
    });
  });

  describe("custody: the portable plaintext → encrypted conversion (§8.1)", () => {
    it("copies schema, rows and indexes into a keyed database", async () => {
      const sourceName = scratchName("convert-src");
      const targetName = scratchName("convert-dst");
      const key = rawKeyLiteral(generateKey());

      // A plaintext store with enough shape to prove the copy is faithful: two
      // tables, rows in each, and an index (the thing a naive row-copy drops).
      const source = await SQLite.openDatabaseAsync(sourceName);
      await source.execAsync(`
        CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE note (id INTEGER PRIMARY KEY, person_id INTEGER, body TEXT);
        CREATE INDEX note_by_person ON note (person_id);
      `);
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Mary",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (2, ?)",
        "Henry",
      );
      await source.runAsync(
        "INSERT INTO note (id, person_id, body) VALUES (1, 1, ?)",
        "first",
      );

      try {
        // A no-op on mobile, which has one cipher; kept so both platforms run
        // the same sequence. See key-custody's conversion rules.
        await source.execAsync("PRAGMA cipher='sqlcipher'");
        await source.execAsync(
          `ATTACH DATABASE '${scratchPath(targetName)}' AS enc KEY "${key}"`,
        );

        // Schema from the source's own catalog, so this works for a schema the
        // conversion code doesn't know; then rows.
        const objects = await source.getAllAsync<{
          type: string;
          name: string;
          sql: string | null;
        }>(
          "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
        );
        for (const o of objects) {
          if (o.sql === null) continue;
          // `CREATE TABLE x` → `CREATE TABLE enc.x`, same for indexes.
          await source.execAsync(
            o.sql.replace(
              /^CREATE (TABLE|INDEX|VIEW|TRIGGER) /i,
              (m) => `${m}enc.`,
            ),
          );
        }
        for (const o of objects) {
          if (o.type !== "table") continue;
          await source.execAsync(
            `INSERT INTO enc.${o.name} SELECT * FROM main.${o.name}`,
          );
        }

        await source.execAsync("DETACH DATABASE enc");
        await source.closeAsync();

        // Reopen the target under the key: everything survived.
        const target = await SQLite.openDatabaseAsync(targetName);
        await target.execAsync(`PRAGMA key = "${key}"`);
        const people = await target.getAllAsync<{ name: string }>(
          "SELECT name FROM person ORDER BY id",
        );
        expect(people.map((p) => p.name)).toEqual(["Mary", "Henry"]);
        const note = await target.getFirstAsync<{ body: string }>(
          "SELECT body FROM note WHERE id = 1",
        );
        expect(note?.body).toBe("first");
        const index = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'note_by_person'",
        );
        expect(index?.name).toBe("note_by_person");
        await target.closeAsync();

        // …and the output is ciphertext, not a plaintext copy that tolerated a
        // key; without this the conversion could be a no-op.
        const keyless = await SQLite.openDatabaseAsync(targetName);
        expect(
          await rejects(() => keyless.getFirstAsync("SELECT name FROM person")),
        ).toBe(true);
        await keyless.closeAsync();
      } finally {
        await SQLite.deleteDatabaseAsync(sourceName);
        await SQLite.deleteDatabaseAsync(targetName);
      }
    });
  });

  // Taking on a new recovery phrase, the step every key rotation ends in,
  // against the shipped `adoptRecoveryKey` and `accountDoors`.
  describe("custody: adopting a new recovery key", () => {
    /** A scratch store, doors and a keystore holding only a db-key. */
    async function scratchDevice() {
      const account = `acct-${crypto.randomUUID()}`;
      const storeName = `stores/${account}/leapsake.db`;
      const keyStore = createInMemoryKeyStore();
      const doors = accountDoors(account);
      const db = await SQLite.openDatabaseAsync(storeName);
      const driver = expoSqliteDriver(db);
      await runMigrations(driver);
      const dbKey = generateKey();
      await keyStore.setSecret(DATABASE_KEY, dbKey);
      return {
        keyStore,
        driver,
        doors,
        dbKey,
        cleanup: async () => {
          await db.closeAsync();
          await doors.destroy();
          await discard(storeName);
        },
      };
    }

    it("re-seals the account's doors.db recovery row around the new key", async () => {
      const d = await scratchDevice();
      try {
        const oldKey = generateKey();
        const masterKey = generateKey();
        // The starting state the boot path leaves: a door sealed under the key
        // this device currently holds.
        await d.doors.writeRecovery(sealDbKeyForRecovery(d.dbKey, oldKey));
        await d.keyStore.setSecret(RECOVERY_KEY, oldKey);

        const newKey = generateKey();
        await adoptRecoveryKey({
          keyStore: d.keyStore,
          driver: d.driver,
          recoveryKey: newKey,
          masterKey,
          writeRecoveryDoor: (bytes) => d.doors.writeRecovery(bytes),
        });

        // The row really moved, and the new key opens *this* device's db-key
        // through it — each device seals its own, so that is the property.
        const door = await d.doors.readRecovery();
        expect(
          Array.from(
            openDbKeyFromRecovery(door ?? new Uint8Array(), newKey),
          ).join(),
        ).toBe(Array.from(d.dbKey).join());
        // The keychain copy moved too; stale here and the next launch re-seals
        // the door back under the old key, silently undoing the adoption.
        expect(
          Array.from((await d.keyStore.getSecret(RECOVERY_KEY)) ?? []).join(),
        ).toBe(Array.from(newKey).join());

        // The pairing negative: without it a door that was merely rewritten,
        // or not rewritten at all, would still pass.
        let oldStillOpens = true;
        try {
          openDbKeyFromRecovery(door ?? new Uint8Array(), oldKey);
        } catch {
          oldStillOpens = false;
        }
        expect(oldStillOpens).toBe(false);
      } finally {
        await d.cleanup();
      }
    });

    it("leaves another account's doors alone", async () => {
      // Adopting on one account must not touch a second account's door.
      const a = await scratchDevice();
      const b = await scratchDevice();
      try {
        const bKey = generateKey();
        await b.doors.writeRecovery(sealDbKeyForRecovery(b.dbKey, bKey));

        await adoptRecoveryKey({
          keyStore: a.keyStore,
          driver: a.driver,
          recoveryKey: generateKey(),
          masterKey: generateKey(),
          writeRecoveryDoor: (bytes) => a.doors.writeRecovery(bytes),
        });

        expect(
          Array.from(
            openDbKeyFromRecovery(
              (await b.doors.readRecovery()) ?? new Uint8Array(),
              bKey,
            ),
          ).join(),
        ).toBe(Array.from(b.dbKey).join());
      } finally {
        await a.cleanup();
        await b.cleanup();
      }
    });

    // After keychain loss the device has a fresh identity; the repair binds
    // the account's master key, read through a door, to the new enclave.
    it("re-adopts the account's master key after the keychain is lost", async () => {
      const d = await scratchDevice();
      try {
        // The salt and verifier are filler: this path derives no password.
        const accountMasterKey = generateKey();
        const recoveryKey = generateKey();
        await createAccountRepo(d.driver).create({
          id: crypto.randomUUID(),
          kdfSalt: Uint8Array.from(generateKey()),
          authVerifier: Uint8Array.from(generateKey()),
          kdfAlg: KDF_ALG,
        });
        await createKeyWrapRepo(d.driver).add({
          wrappedKind: "master",
          principalKind: "recovery",
          ciphertext: wrapKey(accountMasterKey, recoveryKey),
          alg: ALG,
        });

        const status = await adoptAccountMasterKey({
          keyStore: d.keyStore,
          driver: d.driver,
          door: { kind: "recovery", recoveryKey },
        });
        expect(status).toBe("adopted");

        // The enclave now vouches for the account's key, so this hands it back
        // rather than minting a stray one.
        const session = await ensureDeviceMasterKey({
          keyStore: d.keyStore,
          driver: d.driver,
        });
        expect(Array.from(session.masterKey).join()).toBe(
          Array.from(accountMasterKey).join(),
        );

        // The pairing negative: a second run is a no-op, so the repair replaces
        // the binding rather than stacking a fresh row on every launch.
        expect(
          await adoptAccountMasterKey({
            keyStore: d.keyStore,
            driver: d.driver,
            door: { kind: "recovery", recoveryKey },
          }),
        ).toBe("unchanged");
      } finally {
        await d.cleanup();
      }
    });

    it("refuses to mint a master key once an account exists", async () => {
      // The guard that makes the repair mandatory: without an enclave door,
      // an account store must not proceed.
      const d = await scratchDevice();
      try {
        await createAccountRepo(d.driver).create({
          id: crypto.randomUUID(),
          kdfSalt: Uint8Array.from(generateKey()),
          authVerifier: Uint8Array.from(generateKey()),
          kdfAlg: KDF_ALG,
        });
        expect(
          await rejects(() =>
            ensureDeviceMasterKey({ keyStore: d.keyStore, driver: d.driver }),
          ),
        ).toBe(true);
      } finally {
        await d.cleanup();
      }
    });

    // A repair that cannot complete leaves the device Degraded: the store
    // opens, nothing syncs, nothing is minted.
    it("degrades instead of throwing when a door cannot be repaired from", async () => {
      const d = await scratchDevice();
      try {
        // No recovery wrap row, so the door cannot produce the master key: the
        // shape a crashed password change leaves.
        await createAccountRepo(d.driver).create({
          id: crypto.randomUUID(),
          kdfSalt: Uint8Array.from(generateKey()),
          authVerifier: Uint8Array.from(generateKey()),
          kdfAlg: KDF_ALG,
        });

        const established = await establishKeySession({
          keyStore: d.keyStore,
          driver: d.driver,
          custody: "encrypted",
          door: { kind: "recovery", recoveryKey: generateKey() },
        });

        expect(established.state).toBe("degraded");
        // Nothing minted: a stray master key is the damage Degraded prevents.
        expect(
          await createKeyWrapRepo(d.driver).getActive({
            wrappedKind: "master",
            principalKind: "enclave",
          }),
        ).toBe(undefined);
        // The repair is still owed, so whichever door works later rewinds.
        expect(
          await createSyncStateRepo(d.driver).getMasterKeyRepairPending(),
        ).toBe(true);
      } finally {
        await d.cleanup();
      }
    });

    it("comes back to ok, and clears the flag, once the door works", async () => {
      // The pairing positive: without it the case above would pass on a
      // function that degraded unconditionally.
      const d = await scratchDevice();
      try {
        const accountMasterKey = generateKey();
        const recoveryKey = generateKey();
        await createAccountRepo(d.driver).create({
          id: crypto.randomUUID(),
          kdfSalt: Uint8Array.from(generateKey()),
          authVerifier: Uint8Array.from(generateKey()),
          kdfAlg: KDF_ALG,
        });
        await createKeyWrapRepo(d.driver).add({
          wrappedKind: "master",
          principalKind: "recovery",
          ciphertext: wrapKey(accountMasterKey, recoveryKey),
          alg: ALG,
        });
        const syncState = createSyncStateRepo(d.driver);
        await syncState.setPushHwm(12_345);
        await syncState.setPullCursor(678);

        const established = await establishKeySession({
          keyStore: d.keyStore,
          driver: d.driver,
          custody: "encrypted",
          door: { kind: "recovery", recoveryKey },
        });

        expect(established.state).toBe("ok");
        expect(
          established.state === "ok"
            ? Array.from(established.keySession!.masterKey).join()
            : "",
        ).toBe(Array.from(accountMasterKey).join());
        expect(await syncState.getMasterKeyRepairPending()).toBe(false);
        // A real repair rewinds both watermarks, so the records this device
        // lost in each direction are re-offered once.
        expect(await syncState.getPushHwm()).toBe(0);
        expect(await syncState.getPullCursor()).toBe(0);
      } finally {
        await d.cleanup();
      }
    });
  });
}
