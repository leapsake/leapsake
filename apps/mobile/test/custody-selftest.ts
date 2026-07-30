import * as SQLite from "expo-sqlite";
import {
  DATABASE_KEY,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  generateKey,
  openDbKeyFromRecovery,
  rawKeyLiteral,
  sealDbKeyForRecovery,
} from "@leapsake/crypto";
import { adoptRecoveryKey } from "@leapsake/core";
import { runMigrations } from "@leapsake/data";
import type { TestApi } from "@leapsake/data/testing";
import {
  convertStoreToEncrypted,
  destroyPlaintextStore,
  storeState,
} from "../db/convert-store";
import { accountDoors, doorsPath } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";

/**
 * The **custody** self-test: proves on-device the two expo-sqlite behaviors that
 * "encryption follows custody" (`plans/encryption/model.md` §7.2) is built on, and
 * that could previously only be taken on faith from SQLCipher's documentation.
 *
 * 1. **A keyless open works.** An Open store (no account) supplies no `PRAGMA key`
 *    at all, so the SQLCipher build must create and reopen an ordinary plaintext
 *    database. Every boot path in the custody work depends on this.
 * 2. **The portable conversion runs** (§8.1). Account creation turns that plaintext
 *    store into an encrypted one via `ATTACH` + copy-from-`sqlite_master` — the one
 *    pattern that works on *both* engines, since desktop has `PRAGMA rekey` but no
 *    `sqlcipher_export` and SQLCipher has the reverse.
 *
 * Each positive case is paired with the negative that makes it non-vacuous: a keyless
 * reopen proves plaintext only if a *keyed* database genuinely refuses one, and the
 * conversion's output is only "encrypted" if it too refuses. Without those pairs a
 * SQLCipher build that silently ignored keys would read as a clean PASS.
 *
 * Runs alongside the driver contract on `leapsake://dev-selftest`, under the same
 * `pnpm test:native` gate — see `apps/mobile/maestro/README.md`.
 */

/** A throwaway database name, unique per case so nothing leaks between them. */
function scratchName(label: string): string {
  return `custody-${label}-${crypto.randomUUID()}.db`;
}

/** Absolute path of a database in expo-sqlite's directory — what `ATTACH` needs
 *  (it resolves relative paths against the process CWD, not the SQLite folder). */
function scratchPath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}

/** Delete a scratch database, ignoring "not found" — cleanup must never mask the
 *  failure that caused it. */
async function discard(name: string): Promise<void> {
  try {
    await SQLite.deleteDatabaseAsync(name);
  } catch {
    // never created, or already gone
  }
}

/** Whether `fn` rejects — the shape both "refuses to open" negatives assert. */
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
    // Guards every case below: if `useSQLCipher` ever stops applying to the build,
    // the plaintext cases would still pass (a stock SQLite opens keyless happily)
    // and we would be proving nothing about the engine we actually ship.
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

    // The file is only genuinely plaintext if a *second*, independent connection
    // reads it with no key — a single session could be decrypting under an implicit
    // one. This is the case the Open store's every subsequent launch depends on.
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

    // The negative that makes the two cases above mean something.
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

    // The behavior the boot path's verification read depends on: applying a key
    // **never fails on its own**, even a wrong one — SQLCipher only objects when
    // something actually reads page 1. That is why the bootstrap follows
    // `PRAGMA key` with a `PRAGMA user_version` instead of trusting the apply:
    // without it a wrong key would surface later, from inside migrations, as
    // "file is not a database".
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
    // §7.4 puts each account's store in its own directory (`stores/<id>/`). Desktop
    // gets that from `mkdir -p`; mobile has no filesystem dependency and passes a
    // *name* to expo-sqlite, so whether a nested name works at all — and whether
    // the intermediate directory is created for us — decides the mobile layout.
    //
    // Note `deleteDatabaseAsync` removes the file but not the directory, so these
    // cases leave an empty `stores/<uuid>/` behind in the app sandbox. Harmless
    // (dev builds only, and the app never enumerates that directory), but it is why
    // a self-tested simulator accumulates them.
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

    // **Forget account** (§7.3) removes one account's store by that same nested
    // name. Opening a nested name is proved above; *deleting* one is a separate
    // expo-sqlite behavior, and it is the step that actually destroys user data —
    // a silent no-op here would leave the store on disk while the roster entry
    // said it was gone, i.e. "deleted" data still sitting in the sandbox.
    it("deletes a store by its nested, per-account name", async () => {
      const name = `stores/acct-${crypto.randomUUID()}/leapsake.db`;
      const db = await SQLite.openDatabaseAsync(name);
      await db.execAsync("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      await db.runAsync("INSERT INTO t (id, v) VALUES (1, ?)", "secret");
      await db.closeAsync();

      await SQLite.deleteDatabaseAsync(name);

      // The negative that makes it non-vacuous: re-opening the same name must
      // give a *fresh, empty* database rather than the rows we just wrote. Without
      // this, a delete that quietly did nothing would still read as a pass.
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

    // **Forget account** must take that account's doors and no others. These drive
    // the shipped `accountDoors` rather than a re-implementation — it takes a slot,
    // so a scratch account id keeps the device's own custody state untouched.
    //
    // A door outliving the store it opened is how "deleted" quietly becomes "still
    // openable"; a door *dying with a store that was not deleted* is the bug slice
    // 7b fixed, and is the case below it.
    it("destroys one account's doors", async () => {
      const account = `acct-${crypto.randomUUID()}`;
      const doors = accountDoors(account);
      try {
        await doors.writePassword(Uint8Array.from([1, 2, 3]));
        await doors.writeRecovery(Uint8Array.from([4, 5, 6]));
        expect((await doors.readPassword())?.length).toBe(3);

        await doors.destroy();

        // Re-reading recreates an *empty* doors database rather than returning the
        // blobs — without this a delete that quietly did nothing would still pass.
        expect(await doors.readPassword()).toBe(undefined);
        expect(await doors.readRecovery()).toBe(undefined);
      } finally {
        await doors.destroy();
      }
    });

    // The regression this slice exists for. Both doors used to live in one
    // device-scoped database, so forgetting either account destroyed the other's
    // password *and* recovery door — silent at the time, and unrecoverable later,
    // when that account's keychain was wiped and neither door was there.
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

    // Doors sit *inside* the store's own directory, which is what makes the case
    // above structural rather than a matter of passing the right predicate.
    it("puts a doors database in its account's store directory", () => {
      const account = `acct-${crypto.randomUUID()}`;
      expect(doorsPath(account)).toBe(`stores/${account}/doors.db`);
    });
  });

  // The production converter, not a re-implementation of it — the sequence above
  // proves the *engine* supports the pattern; this proves the code we ship uses it
  // correctly, including the two things a hand-rolled copy silently drops.
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
        "Ada",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });

        const target = await SQLite.openDatabaseAsync(to);
        await target.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const row = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(row?.name).toBe("Ada");
        const index = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'person_by_name'",
        );
        expect(index?.name).toBe("person_by_name");
        // Without this the next boot re-runs every migration against live tables.
        const version = await target.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        );
        expect(version?.user_version).toBe(27);
        await target.closeAsync();

        // The source is deliberately still there — it dies only once the roster
        // names the replacement (see the converter's doc comment).
        const stillThere = await SQLite.openDatabaseAsync(from);
        const original = await stillThere.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(original?.name).toBe("Ada");
        await stillThere.closeAsync();
      } finally {
        // Tolerant on purpose: a `finally` that throws replaces the real failure
        // with a cleanup error, which is exactly how this case first hid an
        // ATTACH failure behind "database not found".
        await discard(from);
        await discard(to);
      }
    });
  });

  /**
   * Joining or recovering an account runs the same irreversible sequence account
   * creation does — **convert (original kept) → roster → destroy the original** —
   * so that a device past the first is encrypted at rest too (`model.md` §7.1).
   *
   * The relay half can't run here, so these cover the two steps that touch this
   * device's files: that the converted store genuinely refuses a keyless read, and
   * that destroying the original leaves nothing plaintext behind. Scratch names
   * only — the real roster and sidecar helpers use fixed database names, and a
   * self-test must not rewrite the custody state of the device it runs on.
   */
  describe("custody: a joined device's store", () => {
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
        "Grace",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });
        // The step join used to skip entirely: without it the device keeps a
        // plaintext copy of everything it just encrypted.
        await destroyPlaintextStore(from);

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
        expect(row?.name).toBe("Grace");
        await target.closeAsync();

        // Re-opening the destroyed name gives a *new, empty* database rather than
        // the old rows — expo-sqlite creates on open, so "gone" reads as "no table".
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

    // A crash between the conversion and the roster entry leaves an encrypted store
    // nobody claims. The retry clears the stranded file first, because the
    // converter's overwrite guard (the case after this one) now refuses to write
    // into it — and before that guard existed, the retry copied every row into a
    // populated database and the user's data arrived twice.
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
        "Grace",
      );
      await source.closeAsync();

      try {
        // The stranded leftover of an attempt that crashed before its roster entry.
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

    /**
     * The converter's two guards — mobile's answer to desktop's `storeFileState`,
     * which reads the SQLite file header directly. expo-sqlite exposes no raw file
     * access, so `storeState` asks the engine instead (open keyless, count
     * `sqlite_master`); these prove that substitute actually distinguishes the three
     * states, on the engine we ship, rather than in principle.
     */
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
        "Ada",
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

        // …and it refused *before* writing: the first conversion's rows are intact
        // and un-duplicated, which is the property the guard is protecting.
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
        "Ada",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (2, ?)",
        "Grace",
      );
      await source.runAsync(
        "INSERT INTO note (id, person_id, body) VALUES (1, 1, ?)",
        "first",
      );

      try {
        // Step 2 of §8.1. Verified 2026-07-27 to be a **no-op on mobile** — SQLCipher
        // has exactly one cipher, so the conversion passes without it — but kept so
        // both platforms run the identical sequence: desktop's
        // better-sqlite3-multiple-ciphers supports several and silently writes the
        // *default* one without this, failing much later with a misleading
        // "file is not a database".
        await source.execAsync("PRAGMA cipher='sqlcipher'");
        await source.execAsync(
          `ATTACH DATABASE '${scratchPath(targetName)}' AS enc KEY "${key}"`,
        );

        // Schema first, then rows — read the definitions back out of the source's
        // own catalog rather than restating them, which is what makes this work for
        // a real store whose schema the conversion code doesn't know.
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

        // Reopen the target on its own connection under the key: everything survived.
        const target = await SQLite.openDatabaseAsync(targetName);
        await target.execAsync(`PRAGMA key = "${key}"`);
        const people = await target.getAllAsync<{ name: string }>(
          "SELECT name FROM person ORDER BY id",
        );
        expect(people.map((p) => p.name)).toEqual(["Ada", "Grace"]);
        const note = await target.getFirstAsync<{ body: string }>(
          "SELECT body FROM note WHERE id = 1",
        );
        expect(note?.body).toBe("first");
        const index = await target.getFirstAsync<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'note_by_person'",
        );
        expect(index?.name).toBe("note_by_person");
        await target.closeAsync();

        // …and the output is genuinely ciphertext, not a plaintext copy that merely
        // tolerated a key. Without this the whole conversion could be a no-op.
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

  /**
   * Custody slice 8 — **taking on a new recovery phrase**, against the shipped
   * `adoptRecoveryKey` and the shipped `accountDoors`, on the engine this app runs.
   * It is the step both paths that change the key end in: a rotation performed
   * here, and one performed on another device that this one catches up to.
   *
   * **Deliberately no password anywhere in this suite.** The password gate costs an
   * Argon2id pass (19 MiB, 2 rounds) which on Hermes, unJITted, in a dev bundle,
   * runs for *minutes* — enough to make this whole tier look hung. It is also not
   * a mobile question: the gate and the full rotation are proved in
   * `apps/desktop/test/integration/rotate-recovery.test.ts` and against a live
   * relay in `apps/server/test/relay.test.ts`. What is only provable here is that
   * the new key lands in `stores/<account>/doors.db` and reopens *this* device's
   * db-key.
   *
   * Scratch throughout — an in-memory keystore and a scratch account id — so the
   * device's own custody state is untouched, the same trick the door cases use.
   */
  describe("custody: adopting a new recovery key", () => {
    /** A scratch store + doors + keystore holding a db-key, and nothing else. */
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

        // The pairing negative — without it a door that was merely rewritten, or
        // not rewritten at all, would still read as a pass.
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
      // The per-account scoping slice 7b established, on the path slice 8 added:
      // adopting on one account must not touch a second account's door.
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
  });
}
