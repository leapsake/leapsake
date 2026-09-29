import * as SQLite from "expo-sqlite";
import { rawKeyLiteral } from "@leapsake/crypto";
import { type AccountRoster, storePath } from "@leapsake/store-layout";
import { accountDoors } from "./doors";

/**
 * Copy the plaintext store at `fromName` into an encrypted one at `toName`.
 * Its rules: `@leapsake/key-custody` → Before you change the conversion.
 */
export async function convertStoreToEncrypted(opts: {
  fromName: string;
  toName: string;
  key: Uint8Array;
}): Promise<void> {
  const { fromName, toName, key: toKey } = opts;

  if ((await storeState(fromName)) === "encrypted") {
    throw new Error(
      "Refusing to convert: the source store is not a plaintext database.",
    );
  }
  // Also the `mkdir -p` the ATTACH needs: expo-sqlite creates the account's
  // directory when `storeState` opens the name.
  if ((await storeState(toName)) !== "empty") {
    throw new Error(
      "Refusing to convert: a store already exists at the destination.",
    );
  }

  // The guard proved the destination empty, so a failure leaves only ours.
  try {
    // Own connections: expo-sqlite shares a handle per name, and the `finally`
    // would close the one the running store still holds.
    const source = await SQLite.openDatabaseAsync(fromName, {
      useNewConnection: true,
    });
    try {
      const versionRow = await source.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      const userVersion = versionRow?.user_version ?? 0;

      await source.execAsync("PRAGMA cipher='sqlcipher'");
      await source.execAsync(
        `ATTACH DATABASE '${databasePath(toName)}' AS enc KEY "${rawKeyLiteral(toKey)}"`,
      );

      const objects = await source.getAllAsync<{
        type: string;
        name: string;
        sql: string;
      }>(
        `SELECT type, name, sql FROM sqlite_master
          WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
      );

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
    const check = await SQLite.openDatabaseAsync(toName, {
      useNewConnection: true,
    });
    try {
      await check.execAsync(`PRAGMA key = "${rawKeyLiteral(toKey)}"`);
      await check.getFirstAsync("PRAGMA user_version");
    } finally {
      await check.closeAsync();
    }
  } catch (error) {
    // Best-effort, so the original error survives. A killed process runs no
    // `catch`; {@link clearUnclaimedDestination} sweeps that leftover.
    try {
      await destroyStoreFiles(toName);
    } catch {
      // The original error is the one worth raising.
    }
    throw error;
  }
}

/**
 * What sits at a store name, by a keyless open, which creates the file. So
 * "empty" includes absent, and "encrypted" includes corrupt.
 */
export async function storeState(
  name: string,
): Promise<"empty" | "plaintext" | "encrypted"> {
  // A shared handle would be the caller's keyed one, reading as plaintext.
  const db = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
  try {
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master",
    );
    return (row?.n ?? 0) === 0 ? "empty" : "plaintext";
  } catch {
    // SQLCipher refuses the read rather than the open.
    return "encrypted";
  } finally {
    await db.closeAsync();
  }
}

/** Delete a store, of either custody, once the roster names its replacement. */
export async function destroyStoreFiles(name: string): Promise<void> {
  await SQLite.deleteDatabaseAsync(name);
}

/**
 * Remove a store and its doors that no roster entry names, left by a killed
 * attempt. Mobile has no directory delete, so the doors go by name.
 */
export async function clearUnclaimedDestination(opts: {
  /** The account the destination store is named after. */
  accountId: string;
  roster: AccountRoster;
}): Promise<void> {
  const { accountId, roster } = opts;
  if ((await roster.list()).some((a) => a.id === accountId)) return;
  try {
    await destroyStoreFiles(storePath(accountId));
  } catch {
    // `deleteDatabaseAsync` throws for a missing file, the ordinary case.
  }
  await accountDoors(accountId).destroy();
}

/** Absolute, since `ATTACH` resolves a relative name against the CWD. */
function databasePath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}
