import { afterEach, describe, expect, test } from "vitest";
import { runMigrations } from "@leapsake/data";
import { makeEncryptedTestDriver } from "../support/encrypted-test-driver.js";

/**
 * The table conventions every migration follows, asserted against the schema the
 * migrations actually produce rather than stated in a document that can drift from
 * them. A new table that forgets a tombstone or spells a column in camelCase fails
 * here, at the point the mistake is cheap.
 *
 * The rules themselves are the interesting part:
 *
 * - **A `TEXT` primary key called `id`**, client-generated (a UUID). Two offline
 *   devices both minting rows means the database cannot be the thing that assigns
 *   identity.
 * - **`created_at` / `updated_at` / `deleted_at` as `INTEGER`** epoch milliseconds,
 *   UTC. Never a SQLite date string — the two engines format them differently.
 * - **`deleted_at` is nullable and rows are never hard-deleted.** A hard delete
 *   cannot replicate: a row that is simply gone is indistinguishable from a row a
 *   device has not seen yet, so a tombstone is the only durable way to say "gone".
 *   This test can only prove the *column* exists; that repositories use it instead
 *   of `DELETE` is proven by their own soft-delete tests.
 * - **`snake_case` everywhere.** Repositories map to camelCase at the boundary.
 * - **No `CHECK` constraints.** Value constraints (enums, partial-date rules) live
 *   in Zod so the same portable SQL runs on both engines, and so a constraint that
 *   changes doesn't need a table rebuild to relax — see the note above
 *   `social_profiles` in `migrations.ts`.
 */

// The one table that is deliberately none of the above. It is not a domain entity: it
// is the sync watermark, a key/value row per syncable table, local to this device and
// never itself replicated — so it has no identity to mint, no history to stamp, and
// nothing a tombstone could tell another device. Adding to this list means arguing the
// same case; it is not a place to park a table that simply hasn't been fixed yet.
const NOT_DOMAIN_TABLES = new Set(["sync_state"]);

const isSnakeCase = (s: string) => /^[a-z][a-z0-9_]*$/.test(s);

describe("schema conventions", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  const schema = async () => {
    const h = makeEncryptedTestDriver();
    cleanup = h.cleanup;
    await runMigrations(h.driver);
    const tables = await h.driver.all<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    const columns = new Map<
      string,
      { name: string; type: string; pk: number }[]
    >();
    for (const t of tables) {
      columns.set(
        t.name,
        await h.driver.all<{ name: string; type: string; pk: number }>(
          `PRAGMA table_info(${t.name})`,
        ),
      );
    }
    return { tables, columns };
  };

  test("every domain table has a TEXT id primary key", async () => {
    const { tables, columns } = await schema();
    const offenders = tables
      .filter((t) => !NOT_DOMAIN_TABLES.has(t.name))
      .filter((t) => {
        const pks = columns.get(t.name)!.filter((c) => c.pk > 0);
        return (
          pks.length !== 1 || pks[0].name !== "id" || pks[0].type !== "TEXT"
        );
      })
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  test("every domain table stamps created_at, updated_at and deleted_at as INTEGER", async () => {
    const { tables, columns } = await schema();
    const offenders: string[] = [];
    for (const t of tables) {
      if (NOT_DOMAIN_TABLES.has(t.name)) continue;
      const byName = new Map(columns.get(t.name)!.map((c) => [c.name, c]));
      for (const stamp of ["created_at", "updated_at", "deleted_at"]) {
        const col = byName.get(stamp);
        if (!col) offenders.push(`${t.name}.${stamp} missing`);
        else if (col.type !== "INTEGER")
          offenders.push(`${t.name}.${stamp} is ${col.type}, want INTEGER`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every table and column is snake_case", async () => {
    const { tables, columns } = await schema();
    const offenders: string[] = [];
    for (const t of tables) {
      if (!isSnakeCase(t.name)) offenders.push(t.name);
      for (const c of columns.get(t.name)!) {
        if (!isSnakeCase(c.name)) offenders.push(`${t.name}.${c.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no table carries a CHECK constraint", async () => {
    const { tables } = await schema();
    const offenders = tables
      .filter((t) => /\bCHECK\s*\(/i.test(t.sql ?? ""))
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });
});
