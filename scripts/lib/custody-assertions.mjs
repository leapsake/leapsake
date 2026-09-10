// The **out-of-band half** of the crucial-flow catalog: what the app's bytes on disk say,
// as opposed to what its screen says.
//
// Every other assertion in the E2E tier reads the accessibility tree, and that is a real
// hole: a build that rendered "your data is encrypted" and encrypted nothing would pass
// the whole suite green. These checks step outside the app and read the files
// (`plans/testing/crucial-flows.md` → *Asserting on custody*, which owns the table and the
// rules). Four of the catalog's five rows are here; the fifth is the OS key store, and
// {@link KEY_STORE_NOTE} says where that one stands.
//
// **Two rules from the catalog shape everything below, and both are load-bearing:**
//
//   - *Never call into app code.* An app reporting "I am encrypted" is exactly the
//     evidence a build that encrypted nothing would also produce. Nothing here imports
//     from the app, and the store database is never opened — its custody is decided from
//     sixteen bytes.
//   - *Only in addition to an on-screen assertion, never instead of one.* These attach to
//     flows that already assert on screen (`scripts/test-e2e.mjs`).
//
// **Why this is a separate module from the harness.** `mobile-harness.mjs` owns
// environment plumbing and says nothing about what a flow asserts; these are assertions.
// Keeping them here, as pure functions over one directory path, is also the only way they
// get tested: their *negative* cases — the ones that prove a check can go red at all — are
// unreachable from a simulator, and an assertion that never fires looks exactly like one
// that passes. See `custody-assertions.test.mjs`.
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// The on-disk layout, spelled here because it cannot be imported: the definitions live in
// `packages/store-layout/src/paths.ts` and `apps/mobile/db/{doors,roster-storage}.ts`,
// which are TypeScript the package publishes unbuilt — there is no `.js` for a `.mjs`
// script to reach. Mirrored, not owned: if a path moves there, it moves here, and the
// fixtures in the test file (which use these same names) are what will notice.
const STORES_DIR = "stores";
const UNAUTHENTICATED_SLOT = "local"; // `UNAUTHENTICATED_STORE_SLOT` in paths.ts
const STORE_FILE = "leapsake.db";
const DOORS_FILE = "doors.db"; // `doorsPath` in apps/mobile/db/doors.ts
const ROSTER_FILE = "leapsake-roster.db"; // `ROSTER_DB` in apps/mobile/db/roster-storage.ts

/** The 16-byte magic every unencrypted SQLite file starts with. */
const SQLITE_MAGIC = "SQLite format 3";

/**
 * The row this module does not assert, printed on every run — a pass included, so the gap
 * is visible rather than merely absent.
 *
 * `xcrun simctl keychain` offers `add-cert`, `add-root-cert` and `reset`, and **no read
 * verb**, which is why the harness's `wipe` resets the whole keychain rather than
 * inspecting it. Deferred deliberately, not overlooked: an in-app inspection screen is
 * refused on principle (see the header), so this row needs a host-side answer that does
 * not exist yet.
 */
export const KEY_STORE_NOTE =
  "key store: not asserted — `simctl keychain` has no read verb " +
  "(plans/testing/crucial-flows.md → Asserting on custody)";

/**
 * What is sitting at a store path, decided **without opening a database** — the harness's
 * copy of `apps/desktop/src/main/db/sqlite-header.ts`, four states and all.
 *
 * `empty` is a real state rather than a curiosity: SQLite creates the file on open and
 * writes no header until the first write, so a store that was opened and never written
 * matches *neither* magic. Folding it into `encrypted` (as "not plaintext" would) is the
 * bug the desktop original documents, and the two callers below want to answer it
 * differently — so it is kept distinct here and decided there.
 */
export function fileState(path) {
  let size;
  try {
    size = statSync(path).size;
  } catch {
    return "absent";
  }
  if (size === 0) return "empty";

  const header = Buffer.alloc(16);
  const fd = openSync(path, "r");
  try {
    readSync(fd, header, 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString("latin1").startsWith(SQLITE_MAGIC)
    ? "plaintext"
    : "encrypted";
}

/**
 * Run one query against a database **without touching the app's copy of it**.
 *
 * ⚠️ **A bare `new DatabaseSync(path)` creates the file.** That is not a detail: a check
 * asking "does the roster exist?" would then answer by planting a roster in a live app's
 * container — passing, and destroying the evidence, in one move. So: `existsSync` first
 * (absence is an answer, not something to open), and `readOnly` after.
 *
 * The read is in place because neither `expo-sqlite` nor `apps/mobile/db/` sets
 * `journal_mode = WAL`, so there is nothing uncheckpointed to miss and no `-shm` a
 * read-only connection would need to write. If a `-wal` sidecar ever does appear, the
 * database is snapshotted to a temp directory and the **copy** is opened read-write, so
 * SQLite may recover the log into a file nobody else owns — never into the app's.
 *
 * @returns `{ rows }`, or `{ error }` with a message worth printing. A table that does not
 * exist reads as zero rows: `doors.ts` and `roster-storage.ts` both `CREATE TABLE IF NOT
 * EXISTS` on every open, read included, so its absence means "nothing was ever written",
 * which is precisely what a caller counting rows wants to hear.
 */
function queryAll(dbPath, sql) {
  if (!existsSync(dbPath)) return { rows: [] };

  const hot = existsSync(`${dbPath}-wal`);
  const scratch = hot
    ? mkdtempSync(join(tmpdir(), "leapsake-custody-"))
    : undefined;
  try {
    let openPath = dbPath;
    let options = { readOnly: true };
    if (scratch !== undefined) {
      openPath = join(scratch, basename(dbPath));
      copyFileSync(dbPath, openPath);
      for (const ext of ["-wal", "-shm"]) {
        if (existsSync(`${dbPath}${ext}`)) {
          copyFileSync(`${dbPath}${ext}`, `${openPath}${ext}`);
        }
      }
      options = {}; // the copy is disposable, so let WAL recovery run
    }

    const db = new DatabaseSync(openPath, options);
    try {
      return { rows: db.prepare(sql).all() };
    } catch (error) {
      if (/no such table/i.test(error.message)) return { rows: [] };
      return { error: `could not read ${basename(dbPath)}: ${error.message}` };
    } finally {
      db.close();
    }
  } catch (error) {
    return { error: `could not open ${basename(dbPath)}: ${error.message}` };
  } finally {
    if (scratch !== undefined)
      rmSync(scratch, { recursive: true, force: true });
  }
}

const storeDir = (root, slot) => join(root, STORES_DIR, slot);
const storePath = (root, slot) => join(storeDir(root, slot), STORE_FILE);
const doorsDbPath = (root, slot) => join(storeDir(root, slot), DOORS_FILE);

/** Every slot directory under `stores/`, whether or not it still holds a store file. */
function slots(root) {
  try {
    return readdirSync(join(root, STORES_DIR), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * The accounts this device knows about (encryption `model.md` §7.4).
 *
 * ⚠️ **The roster is one row holding a JSON blob**, not a row per account —
 * `roster (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)` — and the blob is
 * `{ version, accounts: [...] }` (`packages/store-layout/src/roster.ts`). Counting rows
 * would answer 1 for a device with no accounts at all.
 */
function readRoster(root) {
  const { rows, error } = queryAll(
    join(root, ROSTER_FILE),
    "SELECT json FROM roster WHERE id = 1",
  );
  if (error !== undefined) return { error };
  if (rows.length === 0) return { accounts: [] };

  let parsed;
  try {
    parsed = JSON.parse(rows[0].json);
  } catch (cause) {
    return {
      error: `the account roster is not readable JSON: ${cause.message}`,
    };
  }
  if (!Array.isArray(parsed?.accounts)) {
    return { error: "the account roster has no `accounts` array" };
  }
  return { accounts: parsed.accounts };
}

/**
 * Which doors one slot holds, by `kind` — never the blob, which is opaque ciphertext and
 * none of a custody check's business. The table is `door`, singular
 * (`apps/mobile/db/doors.ts`).
 */
function readDoorKinds(root, slot) {
  const { rows, error } = queryAll(
    doorsDbPath(root, slot),
    "SELECT kind FROM door ORDER BY kind",
  );
  if (error !== undefined) return { error };
  return { kinds: rows.map((row) => row.kind) };
}

/** `undefined` when nothing failed; otherwise every failure, in one report. */
function report(root, failures) {
  if (failures.length === 0) return undefined;
  return [`in ${root}:`, ...failures, KEY_STORE_NOTE].join("\n  ");
}

/**
 * **Flow 1's out-of-band half** — a first run mints nothing.
 *
 * The store is plaintext and sits in the Unauthenticated slot, no account store exists,
 * the roster is empty, and no door has been written anywhere.
 *
 * @param root the app's SQLite directory (iOS: `<container>/Documents/SQLite`)
 * @returns `undefined` when every check holds, else a printable report
 */
export function custodyUnauthenticated(root) {
  const failures = [];

  // 1. Store custody + location.
  const local = storePath(root, UNAUTHENTICATED_SLOT);
  const state = fileState(local);
  if (state === "encrypted") {
    failures.push(
      `${STORES_DIR}/${UNAUTHENTICATED_SLOT}/${STORE_FILE} does not begin with ` +
        "`SQLite format 3\\0` — an Unauthenticated store must be plaintext, and this " +
        "one is ciphertext",
    );
  } else if (state === "absent") {
    failures.push(
      `no Unauthenticated store at ${STORES_DIR}/${UNAUTHENTICATED_SLOT}/${STORE_FILE} — ` +
        "Flow 1 leaves the app booted, so the store it booted should be on disk",
    );
  } else if (state === "empty") {
    // Deliberately a failure rather than a shrug. The app opens the derived store path
    // and runs migrations on boot (`apps/mobile/lib/core-context.tsx`), and a migration
    // is a write — so by the time Flow 1's on-screen assertions pass, the header is
    // written. Zero bytes means the store was created and never touched, which is a fact
    // about boot ordering worth surfacing once rather than accepting forever.
    failures.push(
      `${STORES_DIR}/${UNAUTHENTICATED_SLOT}/${STORE_FILE} is zero bytes — the store was ` +
        "created but never written, so no migration has run against it",
    );
  }

  // 2. No account store, and no doors, anywhere.
  for (const slot of slots(root)) {
    if (slot !== UNAUTHENTICATED_SLOT) {
      const accountState = fileState(storePath(root, slot));
      if (accountState !== "absent") {
        failures.push(
          `an account store exists on a first run: ${STORES_DIR}/${slot}/${STORE_FILE} ` +
            `(${accountState})`,
        );
      }
    }
    const { kinds, error } = readDoorKinds(root, slot);
    if (error !== undefined) failures.push(error);
    else if (kinds.length > 0) {
      failures.push(
        `a db-key door exists on a first run: ${STORES_DIR}/${slot}/${DOORS_FILE} holds ` +
          kinds.join(", "),
      );
    }
  }

  // 3. Roster.
  const roster = readRoster(root);
  if (roster.error !== undefined) failures.push(roster.error);
  else if (roster.accounts.length > 0) {
    failures.push(
      `the account roster lists ${roster.accounts.length} account(s) after a first run: ` +
        roster.accounts.map((account) => account.id).join(", "),
    );
  }

  return report(root, failures);
}

/**
 * **Flow 4's out-of-band half** — an account turned encryption on.
 *
 * The store is now ciphertext under `stores/<accountId>/`, the plaintext original is gone,
 * the roster names exactly one account, and both doors exist.
 *
 * @param root the app's SQLite directory (iOS: `<container>/Documents/SQLite`)
 * @returns `undefined` when every check holds, else a printable report
 */
export function custodyAuthenticated(root) {
  const failures = [];

  // 0. The roster first — it is what names the account, so everything else is keyed on it
  //    and reporting the rest without it would be noise about a slot nobody claims.
  const roster = readRoster(root);
  if (roster.error !== undefined) return report(root, [roster.error]);
  if (roster.accounts.length !== 1) {
    return report(root, [
      `the account roster holds ${roster.accounts.length} account(s) after account ` +
        "creation, expected exactly 1" +
        (roster.accounts.length === 0
          ? ""
          : `: ${roster.accounts.map((account) => account.id).join(", ")}`),
    ]);
  }
  const { id } = roster.accounts[0];
  if (typeof id !== "string" || id === "") {
    return report(root, ["the account roster's one entry has no id"]);
  }

  // 1. Store custody + location. This is the check the whole exercise exists for.
  const state = fileState(storePath(root, id));
  if (state === "plaintext") {
    failures.push(
      `${STORES_DIR}/${id}/${STORE_FILE} still begins with \`SQLite format 3\\0\` — the ` +
        "account's store is PLAINTEXT: this build encrypted nothing",
    );
  } else if (state !== "encrypted") {
    // `empty` fails here where it passes in Flow 1: the converter writes the whole
    // encrypted copy before the original is dropped, so zero bytes is a real defect.
    failures.push(
      `the account's store at ${STORES_DIR}/${id}/${STORE_FILE} is ${state} — the ` +
        "conversion should have written a full encrypted copy",
    );
  }

  // 2. The plaintext original is gone.
  //
  // ⚠️ **"Gone" means the file, not the directory.** `stores/local/` survives a conversion
  // as an empty directory while its `.db` is deleted, so a check written against the
  // directory goes red against a correct app.
  const localState = fileState(storePath(root, UNAUTHENTICATED_SLOT));
  if (localState !== "absent") {
    failures.push(
      `${STORES_DIR}/${UNAUTHENTICATED_SLOT}/${STORE_FILE} still exists (${localState}) ` +
        "after the conversion — the plaintext original must be deleted",
    );
  }

  // 3. Both doors.
  //
  // ⚠️ Asserted on **rows**, not on the file: `readBlob` and `writeBlob` both run
  // `CREATE TABLE IF NOT EXISTS` on every open, so an empty `door` table can exist without
  // a door ever having been written.
  const doors = readDoorKinds(root, id);
  if (doors.error !== undefined) failures.push(doors.error);
  else {
    const missing = ["password", "recovery"].filter(
      (kind) => !doors.kinds.includes(kind),
    );
    if (missing.length > 0) {
      failures.push(
        `${STORES_DIR}/${id}/${DOORS_FILE} is missing door kind(s): ` +
          `${missing.join(", ")} (found: ${doors.kinds.join(", ") || "none"})`,
      );
    }
  }

  return report(root, failures);
}
