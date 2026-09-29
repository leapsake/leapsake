// The E2E tier's out-of-band half: what the app's bytes on disk say. See
// `apps/mobile/maestro/README.md` → _The out-of-band half_.
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

// The on-disk layout, mirrored from TypeScript a `.mjs` cannot import; a move
// there moves here.
const STORES_DIR = "stores";
const UNAUTHENTICATED_SLOT = "local"; // `UNAUTHENTICATED_STORE_SLOT` in paths.ts
const STORE_FILE = "leapsake.db";
const DOORS_FILE = "doors.db"; // `doorsPath` in apps/mobile/db/doors.ts
const ROSTER_FILE = "leapsake-roster.db"; // `ROSTER_DB` in roster-storage.ts

/** The 16-byte magic every unencrypted SQLite file starts with. */
const SQLITE_MAGIC = "SQLite format 3";

/** The unasserted key-store row, printed on every run, as `simctl keychain`
 *  has no read verb. */
export const KEY_STORE_NOTE =
  "key store: not asserted — `simctl keychain` has no read verb " +
  "(plans/testing/crucial-flows.md → Asserting on custody)";

/** What sits at a store path, from its header alone, as desktop's
 *  `sqlite-header.ts` does; `empty` stays distinct. */
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
 * One query that never touches the app's copy: ⚠️ `DatabaseSync` creates a
 * file, so check it exists, then read only. Returns `{ rows }` or `{ error }`.
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
      options = {}; // the copy is disposable, so WAL recovery may run
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

/** Every slot directory under `stores/`, holding a store file or not. */
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

/** The device's accounts. ⚠️ The roster is one row of JSON, so a row count
 *  says 1 even with none. */
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

/** Which doors a slot holds, by `kind` from the `door` table, never the
 *  blob. */
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

/** Flow 1's check on the SQLite directory `root`: a first run mints nothing.
 *  Returns `undefined`, or a printable report. */
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
    // A failure: boot's migrations write the header before Flow 1 passes, so
    // zero bytes means something skipped them.
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

/** Flow 4's check on `root`: one account, its store ciphertext, both doors,
 *  the plaintext gone. `undefined`, or a report. */
export function custodyAuthenticated(root) {
  const failures = [];

  // 0. The roster first: it names the account everything else is keyed on.
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

  // 1. Store custody and location: the point of the whole exercise.
  const state = fileState(storePath(root, id));
  if (state === "plaintext") {
    failures.push(
      `${STORES_DIR}/${id}/${STORE_FILE} still begins with \`SQLite format 3\\0\` — the ` +
        "account's store is PLAINTEXT: this build encrypted nothing",
    );
  } else if (state !== "encrypted") {
    // Unlike Flow 1, `empty` fails: the converter writes the whole copy first.
    failures.push(
      `the account's store at ${STORES_DIR}/${id}/${STORE_FILE} is ${state} — the ` +
        "conversion should have written a full encrypted copy",
    );
  }

  // 2. ⚠️ The plaintext `.db` is gone; its directory survives, empty.
  const localState = fileState(storePath(root, UNAUTHENTICATED_SLOT));
  if (localState !== "absent") {
    failures.push(
      `${STORES_DIR}/${UNAUTHENTICATED_SLOT}/${STORE_FILE} still exists (${localState}) ` +
        "after the conversion — the plaintext original must be deleted",
    );
  }

  // 3. ⚠️ Both doors, by rows: an empty `door` table exists after any open.
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
