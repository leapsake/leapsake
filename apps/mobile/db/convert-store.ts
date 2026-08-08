import * as SQLite from "expo-sqlite";
import { rawKeyLiteral } from "@leapsake/crypto";

/**
 * Convert the plaintext (**Unauthenticated**) store named `fromName` into an encrypted
 * (**Authenticated**) store at `toName` — the mobile half of account creation
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
 *
 * Both of desktop's guards are enforced here too, via {@link storeState} rather
 * than desktop's file-header read. The destination one is the one that matters:
 * without it a retry after a crash mid-flow copies every row into a store that
 * already holds them, and the user's data arrives twice.
 */
export async function convertStoreToEncrypted(opts: {
  fromName: string;
  toName: string;
  key: Uint8Array;
}): Promise<void> {
  const { fromName, toName, key } = opts;

  if ((await storeState(fromName)) === "encrypted") {
    throw new Error(
      "Refusing to convert: the source store is not a plaintext database.",
    );
  }
  // Note this also performs the mobile `mkdir -p`: `ATTACH` will not create the
  // `stores/<accountId>/` directory (SQLite never makes directories — this is
  // where desktop calls `mkdirSync`), but expo-sqlite *does* create intermediate
  // directories when it opens a database by name, which `storeState` just did.
  // Without that the ATTACH fails with "unable to open database file".
  if ((await storeState(toName)) !== "empty") {
    throw new Error(
      "Refusing to convert: a store already exists at the destination.",
    );
  }

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

/**
 * What is sitting at a store name, as far as this device can tell — mobile's
 * counterpart to desktop's `storeFileState` (`main/db/sqlite-header.ts`).
 *
 * Desktop reads the 16-byte SQLite header and can therefore distinguish *absent*
 * from *empty*. **expo-sqlite exposes no raw file access at all**, so we ask the
 * engine instead: open with no key and count `sqlite_master`. That answers the
 * question the guards actually need — *is it safe to write a fresh store here* —
 * with two consequences worth knowing before relying on it:
 *
 * - **`absent` and `empty` are one answer.** Opening a name creates the file (and
 *   its directories), so asking is not free of side effects. Harmless: an empty
 *   database and no database are equally safe to convert into.
 * - **`encrypted` means "not readable without a key"**, which is also what a
 *   corrupt file looks like. Both are equally unsafe to write over, so the guards
 *   treat them the same.
 */
export async function storeState(
  name: string,
): Promise<"empty" | "plaintext" | "encrypted"> {
  const db = await SQLite.openDatabaseAsync(name);
  try {
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master",
    );
    return (row?.n ?? 0) === 0 ? "empty" : "plaintext";
  } catch {
    // SQLCipher refuses the read rather than the open (see the custody self-test),
    // so a throw here is the signal that a key would be needed.
    return "encrypted";
  } finally {
    await db.closeAsync();
  }
}

/**
 * Delete a store — run only once the roster names its replacement. Custody-blind
 * like desktop's namesake: creation destroys a plaintext original, the merge flow
 * an encrypted one.
 */
export async function destroyStoreFiles(name: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}

/** Absolute path for `ATTACH`, which resolves relative names against the process
 *  CWD rather than expo-sqlite's database directory. */
function storePath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}
