import * as SQLite from "expo-sqlite";
import { generateKey, rawKeyLiteral } from "@leapsake/crypto";
import type { TestApi } from "@leapsake/data/testing";

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
}
