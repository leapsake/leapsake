import { mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3-multiple-ciphers";
import { rawKeyLiteral } from "@leapsake/crypto";
import type { AccountRoster } from "@leapsake/store-layout";
import { openEncryptedDatabase } from "./encrypted-sqlite-driver.js";
import { storeFileState } from "./sqlite-header.js";

/**
 * Convert the plaintext (**Unauthenticated**) store at `fromPath` into an encrypted
 * (**Authenticated**) store at `toPath`, then destroy the original — the one
 * irreversible step of account creation (`model.md` §7.2.1, §8.1).
 *
 * This is the **plaintext-source** door, and it refuses anything else. The
 * encrypted-source door is {@link rekeyStore}, which shares every mechanic below;
 * keeping them apart is what stops an already-encrypted store being fed to the
 * conversion by accident.
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
 * 1. **`PRAGMA cipher='sqlcipher'` before the ATTACH.** It names the cipher for
 *    the file about to be attached, and overrides whatever `main` is using.
 *    Omitted, the attached file inherits `main`'s cipher — and `main` here is
 *    *plaintext*, so there is none to inherit and the new file is written with
 *    the library default (chacha20), then fails to open under
 *    {@link openEncryptedDatabase}'s pinned `sqlcipher` with the misleading
 *    `file is not a database`. On {@link rekeyStore}'s path `main` is already
 *    sqlcipher and would be inherited correctly, so the line is belt-and-braces
 *    there; it stays on both because the destination's cipher should be a
 *    property of this function, not of whatever the source happened to be.
 *    (A no-op on mobile, where SQLCipher has exactly one cipher — kept here
 *    because desktop genuinely needs it.)
 * 2. **`user_version` must be carried across.** It is the migration runner's
 *    watermark and is *not* copied by ATTACH. Losing it would send the next boot
 *    through every migration again, against tables that already exist.
 * 3. **Tables before indexes.** An index cannot be created before its table, and
 *    `sqlite_master` order is not guaranteed to respect that.
 *
 * **This does not delete the original** — {@link destroyStoreFiles} does, and
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
  copyStoreUnderNewKey({
    fromPath: opts.fromPath,
    toPath: opts.toPath,
    toKey: opts.key,
  });
}

/**
 * Copy the store at `fromPath` into a new encrypted store at `toPath` under
 * `toKey` — the shared body of {@link convertStoreToEncrypted} (no `fromKey`,
 * plaintext source) and {@link rekeyStore} (a `fromKey`, encrypted source).
 *
 * The two doors differ only in what they will accept as a source; the guards,
 * the copy, the crash ordering and the proof-open are one implementation on
 * purpose. Splitting them would let the two sets of guards drift apart, which is
 * the failure this file exists to prevent.
 */
function copyStoreUnderNewKey(opts: {
  fromPath: string;
  fromKey?: Uint8Array;
  toPath: string;
  toKey: Uint8Array;
}): void {
  const { fromPath, fromKey, toPath, toKey } = opts;

  // Both doors refuse a source of the wrong custody, and each refusal names its
  // own door: feeding an encrypted store to the plaintext converter (or the
  // reverse) is a caller bug, and a wrong-custody source reported as a key
  // failure would send the reader hunting for the wrong thing.
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

  // Past this line the destination may exist, and the guard above proved it did
  // not a moment ago — so anything found there on the way out is ours to remove.
  try {
    // `storeFileState` reads sixteen bytes, so "encrypted" only ever means *not
    // plaintext* — it cannot tell a store under another key from a corrupt file.
    // The second half of the re-key guard is therefore this open, which is also
    // the working one: a wrong `fromKey` fails here, before the ATTACH has
    // created anything.
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

    // Prove the result opens under the key. The caller keeps the original until
    // the roster points at this one, so a failure here costs nothing.
    openEncryptedDatabase(toPath, toKey).close();
  } catch (error) {
    // A half-written destination is worse here than it looks: in the merge flow
    // `toPath` is a path a roster entry will one day name, and the overwrite
    // guard above would refuse the retry that fixes it. Best-effort on purpose —
    // the failure being reported outranks the tidying, and the directory stays
    // because only the caller knows whether it predates this call.
    //
    // This does **not** make the callers' pre-convert sweep redundant. A `catch`
    // runs on a throw; a SIGKILL or a power cut runs nothing, and that leftover
    // is what the sweep is for.
    try {
      destroyStoreFiles(toPath);
    } catch {
      // Nothing actionable, and the original error is the one worth raising.
    }
    throw error;
  }
}

/**
 * Re-key a store: copy the **encrypted** store at `fromPath`, open under
 * `fromKey`, into a new encrypted store at `toPath` under `toKey`. The
 * encrypted-source door onto {@link convertStoreToEncrypted}'s machinery, and the
 * file-level half of merging a local-only account into a synced one
 * (`encryption/model.md` §7.2.2).
 *
 * **Not `PRAGMA rekey`.** This writes a *new* file and leaves the original
 * untouched and openable. That is the point: until the roster names the
 * replacement the source is the only copy, and on this path it is an account's
 * whole store rather than the empty schema the plaintext conversion starts from.
 * The crash table on {@link convertStoreToEncrypted} therefore reads harder here
 * — its first row is a data-loss guarantee, not a tidiness one.
 *
 * **Never through a plaintext intermediate.** Decrypt-to-disk-then-re-encrypt
 * would be simpler and would write the user's entire database in the clear;
 * `encryption/model.md` §7.2.1 exists to keep that window small, and this path
 * does not open one. `ATTACH` reaches the destination's cipher directly, so the
 * plaintext only ever exists in memory.
 *
 * **Both keys are real parameters, but today's only caller passes the same key
 * twice.** The at-rest `db-key` is minted **per device**, not per account
 * (`database-key.ts`, `model.md` §7.1) — so merging two of *this* device's
 * accounts re-homes the file without changing its lock. The two-key form is for
 * the case that is coming rather than the one that is here: a device that lost
 * its keychain and returned through a password door holds a *fresh* key
 * (`model.md` §6), and its store has to move under it.
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
 * Destroy a store file and the SQLite sidecars that belong to it (`-wal`,
 * `-shm`) — the last step of every flow that converts one store into another,
 * run **only after** the roster names the replacement.
 *
 * **Custody-blind, and named that way on purpose.** It unlinks bytes; whether
 * they were plaintext or ciphertext is the caller's business. Account creation
 * destroys a *plaintext* original. There is also the
 * boot-time sweep in `index.ts`, where an Authenticated launch still finding an
 * Unauthenticated store means a crash between the roster write and this call
 * left a plaintext copy of data the user has already asked to encrypt.
 *
 * **It does not remove the store's doors or its directory.** The `.password` and
 * `.recovery` sidecars live beside the file and outlive this call; a caller
 * retiring a store for good follows with `rmSync(dirname(path))`, which is why
 * this is not called `destroyStore`.
 *
 * The honest limit (§7.2.1): this unlinks the file, and deleted bytes can linger
 * in free space on an SSD. Accepted deliberately — the alternative is never
 * converting at all.
 */
export function destroyStoreFiles(path: string): void {
  for (const target of [path, `${path}-wal`, `${path}-shm`]) {
    rmSync(target, { force: true });
  }
}

/**
 * Clear a destination left behind by an earlier attempt that died before its
 * roster entry — the pre-convert sweep every store-converting flow runs.
 *
 * **The roster is what makes this safe.** A store directory that no roster entry
 * names is claimed by nobody: no boot path will ever open it, and no user can
 * reach it. One that *is* named is somebody's live account, and removing it
 * would be data loss, so this refuses to touch it and lets the caller's own
 * guard report the collision.
 *
 * Without this a retry cannot succeed — {@link convertStoreToEncrypted}'s
 * overwrite guard refuses a non-absent destination, and the leftover from a
 * SIGKILL (which runs no `catch`) is exactly such a destination.
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
