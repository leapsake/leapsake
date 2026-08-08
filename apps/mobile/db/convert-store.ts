import * as SQLite from "expo-sqlite";
import { rawKeyLiteral } from "@leapsake/crypto";
import { type AccountRoster, storePath } from "@leapsake/store-layout";
import { accountDoors } from "./doors";

/**
 * Convert the plaintext (**Unauthenticated**) store named `fromName` into an encrypted
 * (**Authenticated**) store at `toName` — the mobile half of account creation
 * (`model.md` §7.2.1, §8.1). The desktop counterpart is
 * `apps/desktop/src/main/db/convert-store.ts`, and the *pattern is deliberately
 * identical*: neither engine's native shortcut works on the other (desktop has
 * `PRAGMA rekey` but no `sqlcipher_export`; SQLCipher has the reverse), so both
 * run the same ordinary-SQL `ATTACH` + copy-from-`sqlite_master`.
 *
 * This is the **plaintext-source** door, and it refuses anything else. The
 * encrypted-source door is {@link rekeyStore}, which shares every mechanic below
 * via {@link copyStoreUnderNewKey}; keeping them apart is what stops an
 * already-encrypted store being fed to the conversion by accident.
 *
 * Verified on device before being written — the custody self-test
 * (`leapsake://dev-selftest`) exercises this exact sequence, including that
 * expo-sqlite creates the nested per-account directory for us.
 *
 * As on desktop, this **does not delete the original**: the caller destroys it
 * only after the roster names the replacement, so a crash mid-flow always leaves a
 * launchable device.
 */
export async function convertStoreToEncrypted(opts: {
  fromName: string;
  toName: string;
  key: Uint8Array;
}): Promise<void> {
  await copyStoreUnderNewKey({
    fromName: opts.fromName,
    toName: opts.toName,
    toKey: opts.key,
  });
}

/**
 * Re-key a store: copy the **encrypted** store named `fromName`, opened under
 * `fromKey`, into a new encrypted store at `toName` under `toKey`. The
 * encrypted-source door onto {@link convertStoreToEncrypted}'s machinery, and the
 * file-level half of merging a local-only account into a synced one
 * (`plans/v0-1_01_account-merge.md`). Desktop's namesake lives in
 * `main/db/convert-store.ts` and this mirrors it step for step.
 *
 * **This writes a *new* store and leaves the original openable.** That is the
 * point: until the roster names the replacement the source is the only copy, and
 * on this path it is an account's whole store rather than the empty schema the
 * plaintext conversion starts from. The crash ordering the callers rely on —
 * **copy → roster → destroy** — therefore reads harder here: its first step is a
 * data-loss guarantee, not a tidiness one.
 *
 * **Never through a plaintext intermediate.** Decrypt-to-a-scratch-store then
 * re-encrypt would be simpler and would write the user's entire database in the
 * clear; `encryption/model.md` §7.2.1 exists to keep that window small, and this
 * path does not open one. `ATTACH` reaches the destination's cipher directly, so
 * the plaintext only ever exists in memory.
 *
 * **Both keys are real parameters, but today's only caller passes the same key
 * twice.** The at-rest db-key is minted **per device**, not per account
 * (`model.md` §7.1), so merging two of *this* device's accounts re-homes the
 * store without changing its lock. The two-key form is for the case that is
 * coming rather than the one that is here: a device that lost its keychain and
 * came back through a password door holds a *fresh* key (§6), and its store has
 * to move under it.
 */
export async function rekeyStore(opts: {
  fromName: string;
  fromKey: Uint8Array;
  toName: string;
  toKey: Uint8Array;
}): Promise<void> {
  await copyStoreUnderNewKey(opts);
}

/**
 * Copy the store named `fromName` into a new encrypted store at `toName` under
 * `toKey` — the shared body of {@link convertStoreToEncrypted} (no `fromKey`,
 * plaintext source) and {@link rekeyStore} (a `fromKey`, encrypted source).
 *
 * The two doors differ only in what they will accept as a source; the guards, the
 * copy, the crash ordering and the proof-open are one implementation on purpose.
 * Splitting them would let the two sets of guards drift apart, which is the
 * failure this file exists to prevent. Desktop's file says the same of its own
 * pair, and the two platforms are meant to be read side by side.
 *
 * Three details are load-bearing and easy to miss:
 *
 * 1. **`PRAGMA cipher='sqlcipher'` before the ATTACH.** A no-op on this engine
 *    (SQLCipher has exactly one cipher) but kept so both platforms run the
 *    identical sequence — desktop genuinely needs it, because its library would
 *    otherwise write the attached file under a different default cipher.
 * 2. **`user_version` must be carried across.** It is the migration runner's
 *    watermark and is *not* copied by ATTACH. Losing it would send the next boot
 *    through every migration again, against tables that already exist.
 * 3. **Tables before indexes.** An index cannot be created before its table, and
 *    `sqlite_master` order is not guaranteed to respect that.
 *
 * Both of desktop's guards are enforced here too, via {@link storeState} rather
 * than desktop's file-header read. The destination one is the one that matters:
 * without it a retry after a crash mid-flow copies every row into a store that
 * already holds them, and the user's data arrives twice.
 */
async function copyStoreUnderNewKey(opts: {
  fromName: string;
  fromKey?: Uint8Array;
  toName: string;
  toKey: Uint8Array;
}): Promise<void> {
  const { fromName, fromKey, toName, toKey } = opts;

  // Both doors refuse a source of the wrong custody, and each refusal names its
  // own door: feeding an encrypted store to the plaintext converter (or the
  // reverse) is a caller bug, and a wrong-custody source reported as a key
  // failure would send the reader hunting for the wrong thing.
  const sourceState = await storeState(fromName);
  if (fromKey === undefined) {
    if (sourceState === "encrypted") {
      throw new Error(
        "Refusing to convert: the source store is not a plaintext database.",
      );
    }
  } else if (sourceState !== "encrypted") {
    throw new Error(
      "Refusing to re-key: the source store is not an encrypted database.",
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

  // Past this line the destination may hold bytes, and the guard above proved it
  // held none a moment ago — so anything found there on the way out is ours.
  try {
    const source = await SQLite.openDatabaseAsync(fromName);
    try {
      if (fromKey !== undefined) {
        // `storeState` can only report *not readable keyless*, so it cannot tell
        // a store under another key from a corrupt file. The second half of the
        // re-key guard is therefore this open — and, because applying a key never
        // fails on its own, the read after it. A wrong `fromKey` dies here, before
        // the ATTACH has created anything.
        await source.execAsync(`PRAGMA key = "${rawKeyLiteral(fromKey)}"`);
        try {
          await source.getFirstAsync("PRAGMA user_version");
        } catch (cause) {
          throw new Error(
            "Refusing to re-key: the source store does not open under that key.",
            { cause },
          );
        }
      }

      const versionRow = await source.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version",
      );
      const userVersion = versionRow?.user_version ?? 0;

      // (1) Name the destination's cipher *before* attaching.
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

      // (3) Tables before the indexes/views/triggers that depend on them.
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

      // (2) Carry the migration watermark across.
      await source.execAsync(`PRAGMA enc.user_version = ${userVersion}`);
      await source.execAsync("DETACH DATABASE enc");
    } finally {
      await source.closeAsync();
    }

    // Prove the result opens under the key before the caller commits to it. The
    // caller keeps the original until the roster points at this one, so a failure
    // here costs nothing.
    const check = await SQLite.openDatabaseAsync(toName);
    try {
      await check.execAsync(`PRAGMA key = "${rawKeyLiteral(toKey)}"`);
      await check.getFirstAsync("PRAGMA user_version");
    } finally {
      await check.closeAsync();
    }
  } catch (error) {
    // A half-written destination is worse here than it looks: in the merge flow
    // `toName` is a name a roster entry will one day carry, and the overwrite
    // guard above would refuse the retry that fixes it. Best-effort on purpose —
    // the failure being reported outranks the tidying.
    //
    // This does **not** make the callers' pre-copy sweep redundant. A `catch`
    // runs on a throw; a kill or a power cut runs nothing, and that leftover is
    // what {@link clearUnclaimedDestination} is for.
    try {
      await destroyStoreFiles(toName);
    } catch {
      // Nothing actionable, and the original error is the one worth raising.
    }
    throw error;
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

/**
 * Clear a destination left behind by an earlier attempt that died before its
 * roster entry — the pre-copy sweep every store-converting flow runs, and the
 * mobile counterpart of desktop's namesake.
 *
 * **The roster is what makes this safe.** A store an entry does not name is
 * claimed by nobody: no boot path will ever open it, and no user can reach it.
 * One that *is* named is somebody's live account, and removing it would be data
 * loss, so this refuses to touch it and lets the caller's own guard report the
 * collision.
 *
 * Without this a retry cannot succeed — {@link copyStoreUnderNewKey}'s overwrite
 * guard refuses a non-empty destination, and the leftover of a process killed
 * mid-flow (which runs no `catch`) is exactly such a destination.
 *
 * **The doors go with the store.** They live inside its directory (`doors.ts`)
 * and seal a db-key for a store that is about to be replaced, so leaving them
 * would hand the replacement a door onto the wrong key. Desktop gets this for
 * free by removing the whole directory; mobile has no directory primitive, so it
 * names both halves.
 *
 * The roster check comes first on purpose: {@link storeState} would *create* the
 * file it was asked about, so mobile cannot cheaply ask "is anything there?"
 * before deciding whether it is allowed to look.
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
    // Nothing stranded — the ordinary case. `deleteDatabaseAsync` throws rather
    // than shrugging at a missing file.
  }
  await accountDoors(accountId).destroy();
}

/** Absolute path for `ATTACH`, which resolves relative names against the process
 *  CWD rather than expo-sqlite's database directory. */
function databasePath(name: string): string {
  return `${SQLite.defaultDatabaseDirectory}/${name}`;
}
