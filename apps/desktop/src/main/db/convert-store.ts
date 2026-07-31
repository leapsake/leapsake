import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import { openEncryptedDatabase } from "./encrypted-sqlite-driver.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * Convert the plaintext (**Unauthenticated**) store at `fromPath` into an encrypted
 * (**Authenticated**) store at `toPath`, then destroy the original — the one
 * irreversible step of account creation (`model.md` §7.2.1, §8.1).
 *
 * **Why this shape and not a one-liner.** The two engines' native shortcuts are
 * mirror images and neither works on the other: desktop's
 * `better-sqlite3-multiple-ciphers` has `PRAGMA rekey` but no `sqlcipher_export`,
 * and mobile's SQLCipher has the reverse. So both platforms run this same
 * ordinary-SQL pattern — `ATTACH` a keyed file, copy schema then rows out of
 * `sqlite_master` — which is what `sqlcipher_export` does internally. Verified on
 * both engines before being written (`status.md`).
 *
 * Three details are load-bearing and easy to miss:
 *
 * 1. **`PRAGMA cipher='sqlcipher'` before the ATTACH.** Without it the new file is
 *    written with the library's *default* cipher and later fails to open with the
 *    misleading `file is not a database`. (A no-op on mobile, where SQLCipher has
 *    exactly one cipher — kept here because desktop genuinely needs it.)
 * 2. **`user_version` must be carried across.** It is the migration runner's
 *    watermark and is *not* copied by ATTACH. Losing it would send the next boot
 *    through every migration again, against tables that already exist.
 * 3. **Tables before indexes.** An index cannot be created before its table, and
 *    `sqlite_master` order is not guaranteed to respect that.
 *
 * **This does not delete the original** — {@link destroyPlaintextStore} does, and
 * the caller must not call it until the roster entry naming the new store has been
 * written. That ordering is what makes a crash mid-flow survivable:
 *
 * | Crash after… | Next boot sees | Outcome |
 * |---|---|---|
 * | convert | no roster entry → **Unauthenticated** | the plaintext original is still there; the orphaned encrypted store is discarded on retry |
 * | roster write | the account → **Authenticated** | the converted store, intact |
 * | destroy | the account → **Authenticated** | the finished state |
 *
 * Deleting inside the conversion would create a window where the original is gone
 * but nothing yet points at its replacement — the one ordering that loses data.
 */
export function convertStoreToEncrypted(opts: {
  fromPath: string;
  toPath: string;
  key: Uint8Array;
}): void {
  const { fromPath, toPath, key } = opts;

  if (storeFileState(fromPath) !== "plaintext") {
    throw new Error(
      "Refusing to convert: the source store is not a plaintext database.",
    );
  }
  if (storeFileState(toPath) !== "absent") {
    throw new Error(
      "Refusing to convert: a store already exists at the destination.",
    );
  }

  mkdirSync(dirname(toPath), { recursive: true });

  const db = new Database(fromPath);
  try {
    const [{ user_version: userVersion }] = db.pragma("user_version", {
      simple: false,
    }) as { user_version: number }[];

    // (1) Pin the cipher *before* attaching.
    db.pragma("cipher='sqlcipher'");
    db.prepare("ATTACH DATABASE ? AS enc KEY ?").run(
      toPath,
      rawKeyLiteral(key),
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

  // Prove the result opens under the key. The caller keeps the original until the
  // roster points at this one, so a failure here costs nothing.
  openEncryptedDatabase(toPath, key).close();
}

/**
 * Destroy a plaintext store and its SQLite sidecars — the last step of account
 * creation, run **only after** the roster names the encrypted replacement.
 *
 * Also the boot-time sweep: an Authenticated launch that still finds an Unauthenticated store has
 * crashed between the roster write and this call, and the leftover is a plaintext
 * copy of data the user has already asked to encrypt.
 *
 * The honest limit (§7.2.1): this unlinks the file, and deleted bytes can linger
 * in free space on an SSD. Accepted deliberately — the alternative is never
 * converting at all.
 */
export function destroyPlaintextStore(path: string): void {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(target, { force: true });
  }
}
