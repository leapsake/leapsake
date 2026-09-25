import * as SQLite from "expo-sqlite";
import {
  type SqliteDriver,
  runMigrations,
  seedHolidayCatalog,
} from "@leapsake/core";
import { rawKeyLiteral } from "@leapsake/crypto";
import { expoSqliteDriver } from "./expo-sqlite-driver";

/**
 * Open the store at `path` (expo-sqlite creates its directory), keyed when
 * `dbKey` is set, then migrate it and seed the bundled holiday catalog.
 */
export async function openExpoStore(
  path: string,
  dbKey: Uint8Array | undefined,
): Promise<SqliteDriver> {
  const db = await SQLite.openDatabaseAsync(path, { useNewConnection: true });
  const driver = expoSqliteDriver(db);
  if (dbKey !== undefined) {
    // SQLCipher needs the key before any other statement; the read proves it fits.
    await driver.exec(`PRAGMA key = "${rawKeyLiteral(dbKey)}"`);
    try {
      await driver.get("PRAGMA user_version");
    } catch (cause) {
      throw new Error(
        "Failed to open the encrypted database — wrong or missing key.",
        { cause },
      );
    }
  }
  await runMigrations(driver);
  await seedHolidayCatalog({ driver });
  return driver;
}
