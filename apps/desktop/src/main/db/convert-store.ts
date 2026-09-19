import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import type { AccountRoster } from "@leapsake/store-layout";
import { openEncryptedDatabase } from "./encrypted-sqlite-driver.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * Copy the plaintext store into a new encrypted one, leaving the original for
 * the caller: `@leapsake/key-custody` → *Before you change the conversion*.
 */
export function convertStoreToEncrypted(opts: {
  fromPath: string;
  toPath: string;
  key: Uint8Array;
}): void {
  copyStoreUnderNewKey({
    fromPath: opts.fromPath,
    toPath: opts.toPath,
    toKey: opts.key,
  });
}

/** The shared body of both doors, so their guards cannot drift apart. */
function copyStoreUnderNewKey(opts: {
  fromPath: string;
  fromKey?: Uint8Array;
  toPath: string;
  toKey: Uint8Array;
}): void {
  const { fromPath, fromKey, toPath, toKey } = opts;

  // Each door refuses the other's source, naming itself, not a key failure.
  const sourceState = storeFileState(fromPath);
  if (fromKey === undefined) {
    if (sourceState !== "plaintext") {
      throw new Error(
        "Refusing to convert: the source store is not a plaintext database.",
      );
    }
  } else if (sourceState !== "encrypted") {
    throw new Error(
      "Refusing to re-key: the source store is not an encrypted database.",
    );
  }
  if (storeFileState(toPath) !== "absent") {
    throw new Error(
      "Refusing to convert: a store already exists at the destination.",
    );
  }

  mkdirSync(dirname(toPath), { recursive: true });

  // The guard proved the destination absent, so anything there later is ours.
  try {
    // "encrypted" only means *not plaintext*, so a wrong `fromKey` is caught by
    // this open, before the ATTACH creates anything.
    const db =
      fromKey === undefined
        ? new Database(fromPath)
        : openEncryptedDatabase(fromPath, fromKey);
    try {
      const [{ user_version: userVersion }] = db.pragma("user_version", {
        simple: false,
      }) as { user_version: number }[];

      // (1) Name the destination's cipher *before* attaching.
      db.pragma("cipher='sqlcipher'");
      db.prepare("ATTACH DATABASE ? AS enc KEY ?").run(
        toPath,
        rawKeyLiteral(toKey),
      );

      const objects = db
        .prepare(
          `SELECT type, name, sql FROM sqlite_master
          WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
        )
        .all() as { type: string; name: string; sql: string }[];

      // (3) Tables first, then indexes/views/triggers that depend on them.
      const ordered = [
        ...objects.filter((o) => o.type === "table"),
        ...objects.filter((o) => o.type !== "table"),
      ];
      for (const object of ordered) {
        db.exec(
          object.sql.replace(
            /^CREATE (TABLE|INDEX|VIEW|TRIGGER|UNIQUE INDEX)\s+/i,
            (match) => `${match.trimEnd()} enc.`,
          ),
        );
      }
      for (const object of objects) {
        if (object.type !== "table") continue;
        db.exec(
          `INSERT INTO enc."${object.name}" SELECT * FROM main."${object.name}"`,
        );
      }

      // (2) Carry the migration watermark across.
      db.exec(`PRAGMA enc.user_version = ${userVersion}`);
      db.exec("DETACH DATABASE enc");
    } finally {
      db.close();
    }

    // Prove the result opens under the key; the original is still intact.
    openEncryptedDatabase(toPath, toKey).close();
  } catch (error) {
    // Best-effort, so a retry is not refused by the overwrite guard. A kill
    // runs no `catch`, which is what the callers' pre-convert sweep is for.
    try {
      destroyStoreFiles(toPath);
    } catch {
      // The original error is the one worth raising.
    }
    throw error;
  }
}

/**
 * Copy an encrypted store into a new one under `toKey`, leaving the original
 * untouched and openable until the roster names the replacement.
 */
export function rekeyStore(opts: {
  fromPath: string;
  fromKey: Uint8Array;
  toPath: string;
  toKey: Uint8Array;
}): void {
  copyStoreUnderNewKey(opts);
}

/**
 * Delete a store file and its `-wal`/`-shm`, whatever its custody. Its doors
 * and directory stay, so a caller retiring the store removes those too.
 */
export function destroyStoreFiles(path: string): void {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(target, { force: true });
  }
}

/**
 * Clear a destination a killed attempt left behind, but only when no roster
 * entry names it: a named one is somebody's live account.
 */
export async function clearUnclaimedDestination(opts: {
  /** The destination store file; its whole directory is what gets removed. */
  path: string;
  /** The account that directory is named after. */
  accountId: string;
  roster: AccountRoster;
}): Promise<void> {
  const { path, accountId, roster } = opts;
  if (storeFileState(path) === "absent") return;
  if ((await roster.list()).some((a) => a.id === accountId)) return;
  rmSync(dirname(path), { recursive: true, force: true });
}
