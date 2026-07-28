import * as SQLite from "expo-sqlite";
import { rawKeyLiteral } from "@leapsake/crypto";

/**
 * Convert the plaintext (**Open**) store named `fromName` into an encrypted
 * (**Protected**) store at `toName` — the mobile half of account creation
 * (`model.md` §7.2.1, §8.1). The desktop counterpart is
 * `apps/desktop/src/main/db/convert-store.ts`, and the *pattern is deliberately
 * identical*: neither engine's native shortcut works on the other (desktop has
 * `PRAGMA rekey` but no `sqlcipher_export`; SQLCipher has the reverse), so both
 * run the same ordinary-SQL `ATTACH` + copy-from-`sqlite_master`.
 *
 * Verified on device before being written — the custody self-test
 * (`leapsake://dev-selftest`) exercises this exact sequence, including that
 * expo-sqlite creates the nested per-account directory for us.
 *
 * As on desktop, this **does not delete the original**: the caller destroys it
 * only after the roster names the replacement, so a crash mid-flow always leaves a
 * launchable device. `user_version` is carried across explicitly — ATTACH does not
 * copy it, and losing it would re-run every migration against existing tables.
 */
export async function convertStoreToEncrypted(opts: {
  fromName: string;
  toName: string;
  key: Uint8Array;
}): Promise<void> {
  const { fromName, toName, key } = opts;

  // `ATTACH` will not create the `stores/<accountId>/` directory — SQLite never
  // makes directories, and this is where desktop calls `mkdirSync`. expo-sqlite
  // *does* create intermediate directories when it opens a database by name, so
  // opening the destination once (and closing it) is the mobile `mkdir -p`.
  // Without this the ATTACH fails with "unable to open database file".
  await (await SQLite.openDatabaseAsync(toName)).closeAsync();

  const source = await SQLite.openDatabaseAsync(fromName);
  try {
    const versionRow = await source.getFirstAsync<{ user_version: number }>(
      "PRAGMA user_version",
    );
    const userVersion = versionRow?.user_version ?? 0;

    // A no-op on this engine (SQLCipher has exactly one cipher) but kept so both
    // platforms run the identical sequence — desktop genuinely needs it.
    await source.execAsync("PRAGMA cipher='sqlcipher'");
    await source.execAsync(
      `ATTACH DATABASE '${storePath(toName)}' AS enc KEY "${rawKeyLiteral(key)}"`,
    );

    const objects = await source.getAllAsync<{
      type: string;
      name: string;
      sql: string;
    }>(
      `SELECT type, name, sql FROM sqlite_master
        WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
    );

    // Tables before the indexes/views/triggers that depend on them.
    const ordered = [
      ...objects.filter((o) => o.type === "table"),
      ...objects.filter((o) => o.type !== "table"),
    ];
    for (const object of ordered) {
      await source.execAsync(
        object.sql.replace(
          /^CREATE (TABLE|INDEX|VIEW|TRIGGER|UNIQUE INDEX)\s+/i,
          (match) => `${match.trimEnd()} enc.`,
        ),
      );
    }
    for (const object of objects) {
      if (object.type !== "table") continue;
      await source.execAsync(
        `INSERT INTO enc."${object.name}" SELECT * FROM main."${object.name}"`,
      );
    }

    await source.execAsync(`PRAGMA enc.user_version = ${userVersion}`);
    await source.execAsync("DETACH DATABASE enc");
  } finally {
    await source.closeAsync();
  }

  // Prove the result opens under the key before the caller commits to it.
  const check = await SQLite.openDatabaseAsync(toName);
  try {
    await check.execAsync(`PRAGMA key = "${rawKeyLiteral(key)}"`);
    await check.getFirstAsync("PRAGMA user_version");
  } finally {
    await check.closeAsync();
  }
}

/** Delete a plaintext store — run only once the roster names its replacement. */
export async function destroyPlaintextStore(name: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}

/** Absolute path for `ATTACH`, which resolves relative names against the process
 *  CWD rather than expo-sqlite's database directory. */
function storePath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}
