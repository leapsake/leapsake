import * as SQLite from "expo-sqlite";
import {
  ALG,
  DATABASE_KEY,
  KDF_ALG,
  RECOVERY_KEY,
  createInMemoryKeyStore,
  generateKey,
  generateSalt,
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
  getSyncStatus,
} from "@leapsake/core";
import {
  createAccountRepo,
  createKeyWrapRepo,
  createPeopleRepo,
  createSyncStateRepo,
  runMigrations,
} from "@leapsake/data";
import type { TestApi } from "@leapsake/data/testing";
import {
  type AccountRoster,
  type RosterEntry,
  createAccountRoster,
  storePath,
} from "@leapsake/store-layout";
import {
  convertStoreToEncrypted,
  destroyStoreFiles,
  rekeyStore,
  storeState,
} from "../db/convert-store";
import { accountDoors, doorsPath } from "../db/doors";
import { expoSqliteDriver } from "../db/expo-sqlite-driver";
import { mergeAccountOnThisDevice } from "../lib/merge-account";

/**
 * The **custody** self-test: proves on-device the two expo-sqlite behaviors that
 * "encryption follows custody" (`plans/encryption/model.md` §7.2) is built on, and
 * that could previously only be taken on faith from SQLCipher's documentation.
 *
 * 1. **A keyless open works.** An Unauthenticated store (no account) supplies no `PRAGMA key`
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

/**
 * The message `fn` rejects with, or `"<resolved>"` if it did not reject.
 *
 * Use this over {@link rejects} wherever a flow has **more than one way to
 * throw**, which is every flow with guards in front of it. A bare "it rejected"
 * is satisfied by a guard refusing before the flow starts, so it passes while
 * proving nothing — that is how the merge flow's at-rest guard sat in front of
 * the refused-password case for weeks with the case green.
 */
async function rejectionMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "<resolved>";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
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
    // one. This is the case the Unauthenticated store's every subsequent launch depends on.
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
    /**
     * **The case that catches a shared native connection.** expo-sqlite caches
     * connections by database name, so a "keyless" probe of a store the caller
     * already holds open returns that caller's *keyed* connection — the read
     * succeeds and an encrypted store reports `plaintext`. Every caller holding a
     * live driver is in exactly that state, which is why this is not an exotic
     * case: it made the merge flow's at-rest guard refuse every real merge.
     *
     * `storeState` passes `useNewConnection` to avoid it. Drop that option and
     * this case goes red — and so does the merge case further down, which is the
     * one a user would have felt.
     */
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
        expect(original?.name).toBe("Mary");
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
        "Henry",
      );
      await source.closeAsync();

      try {
        await convertStoreToEncrypted({ fromName: from, toName: to, key });
        // The step join used to skip entirely: without it the device keeps a
        // plaintext copy of everything it just encrypted.
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
        "Henry",
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

  /**
   * The **encrypted-source door** (`encryption/model.md` §7.2.2).
   * It shares one private body with the plaintext converter above, so these cases
   * are not re-proving the ATTACH copy — they prove the half that is genuinely its
   * own: that it accepts an encrypted source and refuses everything else, that a
   * wrong key is caught *before* the copy rather than surfacing as corruption, and
   * that the original comes through openable. That last one is the merge's whole
   * safety story — until the roster names the destination, the source is the only
   * copy of the user's account.
   */
  describe("custody: the shipped re-key door", () => {
    it("copies an encrypted store under a new name, original still openable", async () => {
      const from = scratchName("rekey-src");
      const to = `stores/rekey-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
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
        // The same key both ways — today's only caller, the merge, re-homes a
        // store rather than re-locking it (the db-key is per *device*).
        await rekeyStore({
          fromName: from,
          fromKey: key,
          toName: to,
          toKey: key,
        });

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
        const version = await target.getFirstAsync<{ user_version: number }>(
          "PRAGMA user_version",
        );
        expect(version?.user_version).toBe(27);
        await target.closeAsync();

        // The property the crash ordering rests on: this is not a `mv`. Until
        // the roster names the destination the source must still open, and hold
        // everything it held.
        const original = await SQLite.openDatabaseAsync(from);
        await original.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const survivor = await original.getFirstAsync<{ name: string }>(
          "SELECT name FROM person WHERE id = 1",
        );
        expect(survivor?.name).toBe("Mary");
        await original.closeAsync();
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    it("refuses a plaintext source", async () => {
      const from = scratchName("rekey-plain-src");
      const to = `stores/rekey-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync("CREATE TABLE person (id INTEGER PRIMARY KEY)");
      await source.closeAsync();

      try {
        // The mirror of the plaintext door's "already encrypted" refusal. Two
        // doors onto one body, each accepting only its own custody, is what stops
        // a store being fed to the wrong one by accident.
        expect(
          await rejects(() =>
            rekeyStore({
              fromName: from,
              fromKey: key,
              toName: to,
              toKey: key,
            }),
          ),
        ).toBe(true);
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    it("refuses a source that does not open under the given key, before copying", async () => {
      const from = scratchName("rekey-wrong-key");
      const to = `stores/rekey-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
      await source.execAsync("CREATE TABLE person (id INTEGER PRIMARY KEY)");
      await source.closeAsync();

      try {
        expect(
          await rejects(() =>
            rekeyStore({
              fromName: from,
              fromKey: generateKey(),
              toName: to,
              toKey: key,
            }),
          ),
        ).toBe(true);

        // …and it left nothing behind. `storeState` reports *not readable
        // keyless* for a corrupt file exactly as it does for an encrypted one, so
        // a half-written destination would read as "encrypted" and the retry
        // would trip the overwrite guard forever.
        expect(await storeState(to)).toBe("empty");

        // The wrong key must not have damaged the source either.
        const original = await SQLite.openDatabaseAsync(from);
        await original.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
        const table = await original.getFirstAsync<{ n: number }>(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'person'",
        );
        expect(table?.n).toBe(1);
        await original.closeAsync();
      } finally {
        await discard(from);
        await discard(to);
      }
    });

    it("refuses a destination that already holds data", async () => {
      const from = scratchName("rekey-guard-src");
      const to = `stores/rekey-${crypto.randomUUID()}/leapsake.db`;
      const key = generateKey();

      const source = await SQLite.openDatabaseAsync(from);
      await source.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
      await source.execAsync(
        "CREATE TABLE person (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
      );
      await source.runAsync(
        "INSERT INTO person (id, name) VALUES (1, ?)",
        "Mary",
      );
      await source.closeAsync();

      try {
        await rekeyStore({
          fromName: from,
          fromKey: key,
          toName: to,
          toKey: key,
        });
        // The retry that would otherwise double every row.
        expect(
          await rejects(() =>
            rekeyStore({
              fromName: from,
              fromKey: key,
              toName: to,
              toKey: key,
            }),
          ),
        ).toBe(true);

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
  });

  /**
   * **The merge flow itself** (`lib/merge-account.ts`) — mobile's answer to
   * desktop's `test/integration/account-merge.test.ts`, which cannot run here
   * because expo-sqlite has no Node build.
   *
   * The relay half is the injected `adopt` callback, so these drive the real flow
   * end to end with a stub in that seat: a happy path that proves the swap, and a
   * failing one that proves the property the whole copy-first ordering exists for
   * — that a refused login leaves the user's account exactly as it was.
   *
   * Everything is scratch: random account ids (so `storePath` names a store no
   * device holds), an in-memory roster, and an in-memory keystore. A self-test
   * must never rewrite the custody state of the device it runs on.
   */
  describe("custody: merging a local-only account into a synced one", () => {
    /** An {@link AccountRoster} over a string in memory, seeded with `entries`. */
    function scratchRoster(entries: RosterEntry[]): AccountRoster {
      let text: string | undefined = JSON.stringify({
        version: 1,
        accounts: entries,
      });
      return createAccountRoster({
        read: async () => text,
        write: async (next) => {
          text = next;
        },
      });
    }

    /**
     * A store in the shape the merge flow expects to find: encrypted under `key`,
     * migrated, holding one **local-only** account row (no relay) and one person.
     *
     * Built through the repos rather than through `createLocalAccount` on
     * purpose — that derives a KEK from a password, and an Argon2id pass on
     * Hermes runs for minutes. Nothing here needs a real password door; what is
     * under test is where the rows end up.
     */
    async function seedLocalAccount(opts: {
      accountId: string;
      key: Uint8Array;
      firstName: string;
    }): Promise<void> {
      const db = await SQLite.openDatabaseAsync(storePath(opts.accountId));
      const driver = expoSqliteDriver(db);
      await driver.exec(`PRAGMA key = "${rawKeyLiteral(opts.key)}"`);
      await runMigrations(driver);
      await createAccountRepo(driver).create({
        id: opts.accountId,
        kdfSalt: generateSalt(),
        authVerifier: generateSalt(),
        kdfAlg: KDF_ALG,
        username: "local-me",
      });
      await createPeopleRepo(driver).create({
        firstName: opts.firstName,
        lastName: "Bailey",
      });
      await driver.close?.();
    }

    /** Open a scratch store under its key, for the assertions after a flow ran. */
    async function reopen(accountId: string, key: Uint8Array) {
      const driver = expoSqliteDriver(
        await SQLite.openDatabaseAsync(storePath(accountId)),
      );
      await driver.exec(`PRAGMA key = "${rawKeyLiteral(key)}"`);
      return driver;
    }

    /** Both halves of a scratch account's directory. */
    async function discardAccount(accountId: string): Promise<void> {
      await discard(storePath(accountId));
      await discard(doorsPath(accountId));
    }

    it("re-homes the store, swaps the roster and retires the local account", async () => {
      // Bare UUIDs, not the `local-`/`synced-` labels these once carried: an
      // account id reaches `accountSchema`, whose `id` is `z.uuid()`, so a
      // labelled id fails validation at the first `create()` and the case never
      // reaches what it exists to prove. The labels are recoverable from the
      // variable names; the shape has to match production.
      const localId = crypto.randomUUID();
      const syncedId = crypto.randomUUID();
      const key = generateKey();
      const keyStore = createInMemoryKeyStore();
      await keyStore.setSecret(DATABASE_KEY, key);
      const roster = scratchRoster([
        {
          id: localId,
          username: "local-me",
          createdAt: "2026-08-01T00:00:00Z",
        },
      ]);

      try {
        await seedLocalAccount({ accountId: localId, key, firstName: "Mary" });
        const live = await reopen(localId, key);

        const { accountId } = await mergeAccountOnThisDevice({
          keyStore,
          driver: live,
          roster,
          username: "synced-me",
          prelogin: async () => ({ accountId: syncedId }),
          // The relay half, stubbed: what `joinAccountViaRelay` leaves behind is
          // the synced account's row on the driver it was handed, plus a sealed
          // password door. Note the driver it writes to is the *copy*.
          adopt: async (copy, writePasswordSidecar) => {
            await createAccountRepo(copy).create({
              id: syncedId,
              kdfSalt: generateSalt(),
              authVerifier: generateSalt(),
              kdfAlg: KDF_ALG,
              username: "synced-me",
              relayUrl: "http://relay.invalid",
            });
            await writePasswordSidecar(new Uint8Array([1, 2, 3]));
            return { deviceId: crypto.randomUUID(), masterKey: generateKey() };
          },
          closeStore: () => live.close?.() ?? Promise.resolve(),
        });
        expect(accountId).toBe(syncedId);

        // 1. The rows came across, and the store now answers as the synced account.
        const merged = await reopen(syncedId, key);
        const people = await createPeopleRepo(merged).list();
        expect(people.length).toBe(1);
        expect(people[0]?.firstName).toBe("Mary");
        const status = await getSyncStatus({ driver: merged });
        expect(status.accountId).toBe(syncedId);
        expect(status.relayUrl).toBe("http://relay.invalid");
        await merged.close?.();

        // 2. One roster entry, naming the synced account — the point of no return.
        const listed = await roster.list();
        expect(listed.length).toBe(1);
        expect(listed[0]?.id).toBe(syncedId);

        // 3. The password door landed in the *destination's* directory. Writing
        //    it beside the retired store is the bug this ordering exists to
        //    avoid: it would be deleted moments later, at step 10.
        expect(await accountDoors(syncedId).readPassword()).toEqual(
          new Uint8Array([1, 2, 3]),
        );

        // 4. The local store is gone, doors and all. Re-opening a destroyed name
        //    gives a *new, empty* database — expo-sqlite creates on open.
        expect(await storeState(storePath(localId))).toBe("empty");
        expect(await accountDoors(localId).readPassword()).toBeUndefined();
      } finally {
        await discardAccount(localId);
        await discardAccount(syncedId);
      }
    });

    /**
     * **The reason the relay half runs against a copy.** A wrong password is the
     * one moment the user's local account must survive untouched — and the
     * ordering the join path uses (clear the account row, *then* call the relay)
     * would have destroyed it in place. This is the case a happy-path demo cannot
     * show, so it is the one worth having on device.
     */
    it("leaves the live store, its roster entry and the keychain intact when the login fails", async () => {
      // Bare UUIDs — see the sibling case above.
      const localId = crypto.randomUUID();
      const syncedId = crypto.randomUUID();
      const key = generateKey();
      const localRecoveryKey = generateKey();
      const keyStore = createInMemoryKeyStore();
      await keyStore.setSecret(DATABASE_KEY, key);
      await keyStore.setSecret(RECOVERY_KEY, localRecoveryKey);
      const roster = scratchRoster([
        {
          id: localId,
          username: "local-me",
          createdAt: "2026-08-01T00:00:00Z",
        },
      ]);

      try {
        await seedLocalAccount({ accountId: localId, key, firstName: "Henry" });
        const live = await reopen(localId, key);

        // The *message*, not merely "it rejected": this flow has a wall of guards
        // in front of the login, and any of them refusing would satisfy a bare
        // rejects() while proving nothing about the restore path below.
        expect(
          await rejectionMessage(() =>
            mergeAccountOnThisDevice({
              keyStore,
              driver: live,
              roster,
              username: "synced-me",
              prelogin: async () => ({ accountId: syncedId }),
              // A refused password, *after* the join has already replaced this
              // device's recovery key — which is what the real one does
              // (`session.ts`, `joinAccount`) and why the flow's catch has a
              // restore line at all.
              adopt: async () => {
                await keyStore.setSecret(RECOVERY_KEY, generateKey());
                throw new Error("Incorrect username or password.");
              },
              closeStore: () => live.close?.() ?? Promise.resolve(),
            }),
          ),
        ).toBe("Incorrect username or password.");

        // 1. The account the user still has: rows, identity, and no relay. Every
        //    destructive step landed on the copy.
        const original = await reopen(localId, key);
        const people = await createPeopleRepo(original).list();
        expect(people.length).toBe(1);
        expect(people[0]?.firstName).toBe("Henry");
        const status = await getSyncStatus({ driver: original });
        expect(status.accountId).toBe(localId);
        expect(status.relayUrl).toBeUndefined();
        await original.close?.();

        // 2. Still the account this device holds.
        const listed = await roster.list();
        expect(listed.length).toBe(1);
        expect(listed[0]?.id).toBe(localId);

        // 3. The keychain is device-global, so no copy could have protected it.
        //    Without the restore, the bootstrap the caller re-runs would re-seal
        //    the local store's recovery door under the *account's* key — killing
        //    the phrase door of a store the user never left.
        expect(await keyStore.getSecret(RECOVERY_KEY)).toEqual(
          localRecoveryKey,
        );

        // 4. Nothing stranded at the destination, so a retry is not refused by
        //    the converter's overwrite guard.
        expect(await storeState(storePath(syncedId))).toBe("empty");
      } finally {
        await discardAccount(localId);
        await discardAccount(syncedId);
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

    /**
     * Custody slice 9, on the engine this app runs. A device that lost its OS
     * keychain and came back through a door has a *fresh* device identity, so
     * `ensureDeviceMasterKey` would mint a brand-new master key and quietly stop
     * speaking the account's language. The repair reads the account's key back out
     * of the door and binds it to the new enclave.
     *
     * The recovery door, not the password one — same suite rule as above: the
     * password gate is an Argon2id pass and is proved on desktop, while what is
     * only provable here is that the `key_wrap` read/revoke/add cycle behaves on
     * SQLCipher under expo-sqlite.
     */
    it("re-adopts the account's master key after the keychain is lost", async () => {
      const d = await scratchDevice();
      try {
        // An account whose master key is reachable from its recovery door. The
        // salt and verifier are unused on this path (no password is derived), so
        // they are filler rather than a shortcut.
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

        // The enclave now vouches for the account's key, so the call that used to
        // mint a stray one hands back the real one instead.
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
      // The source guard, which is what makes the repair mandatory rather than
      // best-effort: without an enclave door, an account store must not proceed.
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

    /**
     * Custody slice 10 — the boot sequence that decides what those two calls mean
     * for the app: a repair it cannot complete leaves the device **Degraded** (the
     * store opens, nothing syncs, nothing is minted) instead of refusing to open.
     *
     * `custody: "encrypted"` is a label about the account, not about the file, so a
     * scratch store answers the question honestly: what is under test is the
     * sequence and its durable flag, both of which are engine-level behavior worth
     * proving on SQLCipher under expo-sqlite.
     */
    it("degrades instead of throwing when a door cannot be repaired from", async () => {
      const d = await scratchDevice();
      try {
        // An account with **no** recovery wrap row, so the door it is handed cannot
        // produce the account's master key. This is the shape a device is in after a
        // crashed password change, or a join that predated slice 9's fix.
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
        // Nothing minted: a stray master key is the damage the strict posture existed
        // to prevent, and softening it must not reintroduce that.
        expect(
          await createKeyWrapRepo(d.driver).getActive({
            wrappedKind: "master",
            principalKind: "enclave",
          }),
        ).toBe(undefined);
        // And the repair is still owed, so whichever door eventually works rewinds.
        expect(
          await createSyncStateRepo(d.driver).getMasterKeyRepairPending(),
        ).toBe(true);
      } finally {
        await d.cleanup();
      }
    });

    it("comes back to ok, and clears the flag, once the door works", async () => {
      // The pairing positive: the same call on the same store, with the one thing
      // that was missing. Without it the case above would pass on a function that
      // degraded unconditionally.
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
        // A real repair rewinds both watermarks, so the records this device lost in
        // each direction are re-offered once.
        expect(await syncState.getPushHwm()).toBe(0);
        expect(await syncState.getPullCursor()).toBe(0);
      } finally {
        await d.cleanup();
      }
    });
  });
}
