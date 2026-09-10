// What proves the custody checks can go **red**.
//
// These are the only part of the E2E tier reachable without a simulator, and they are the
// part most likely to be silently wrong: an assertion that never fires looks exactly like
// one that passes. So every case below that matters is a *negative* — a tree that is wrong
// in one specific way, and the message that must name it. The happy cases are here to stop
// the negatives from passing for the wrong reason.
//
// Fixtures are built in code, never committed: each test gets its own `mkdtempSync`
// directory, torn down afterwards, so two runs (or two runners) cannot collide. The roster
// and doors databases are written with real `node:sqlite` against the app's own schema
// strings, so a schema drift in `apps/mobile/db/` shows up here rather than on a simulator.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  custodyAuthenticated,
  custodyUnauthenticated,
  fileState,
} from "./custody-assertions.mjs";

const roots = [];
afterEach(() => {
  while (roots.length > 0)
    rmSync(roots.pop(), { recursive: true, force: true });
});

function newRoot() {
  const root = mkdtempSync(join(tmpdir(), "leapsake-custody-test-"));
  roots.push(root);
  return root;
}

/** A store file in one of the four states `fileState` distinguishes. */
function writeStore(root, slot, state) {
  const dir = join(root, "stores", slot);
  mkdirSync(dir, { recursive: true });
  if (state === "absent") return;
  const path = join(dir, "leapsake.db");
  if (state === "empty") writeFileSync(path, Buffer.alloc(0));
  else if (state === "plaintext") {
    writeFileSync(
      path,
      Buffer.concat([
        Buffer.from("SQLite format 3\0", "latin1"),
        Buffer.alloc(80),
      ]),
    );
  } else
    writeFileSync(path, Buffer.from("f3b2e369a71c4d0e8815f2b6d4a90c37", "hex"));
}

/** The roster's real shape: one row, one JSON blob (`apps/mobile/db/roster-storage.ts`). */
function writeRoster(root, accounts, raw) {
  const db = new DatabaseSync(join(root, "leapsake-roster.db"));
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS roster (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)",
    );
    const json =
      raw ?? `${JSON.stringify({ version: 1, accounts }, null, 2)}\n`;
    db.prepare("INSERT OR REPLACE INTO roster (id, json) VALUES (1, ?)").run(
      json,
    );
  } finally {
    db.close();
  }
}

/** The doors' real shape: table `door`, singular (`apps/mobile/db/doors.ts`). */
function writeDoors(root, slot, kinds) {
  const dir = join(root, "stores", slot);
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "doors.db"));
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS door (kind TEXT PRIMARY KEY, blob TEXT NOT NULL)",
    );
    for (const kind of kinds) {
      db.prepare("INSERT OR REPLACE INTO door (kind, blob) VALUES (?, ?)").run(
        kind,
        "ZmFrZQ==",
      );
    }
  } finally {
    db.close();
  }
}

const ACCOUNT = "acct-4f1d0f3e-2c7a-4b19-9a2e-0d5c8e6b7a10";
const account = (id = ACCOUNT) => ({
  id,
  username: "ada",
  createdAt: "2026-09-09T12:00:00.000Z",
});

/** A tree exactly as Flow 1 leaves one. */
function firstRunTree() {
  const root = newRoot();
  writeStore(root, "local", "plaintext");
  return root;
}

/** A tree exactly as Flow 4 leaves one — including the empty `stores/local/` directory. */
function convertedTree() {
  const root = newRoot();
  writeStore(root, "local", "absent"); // the directory survives; the .db does not
  writeStore(root, ACCOUNT, "encrypted");
  writeDoors(root, ACCOUNT, ["password", "recovery"]);
  writeRoster(root, [account()]);
  return root;
}

describe("fileState", () => {
  it("tells the four states apart", () => {
    const root = newRoot();
    writeStore(root, "a", "plaintext");
    writeStore(root, "b", "encrypted");
    writeStore(root, "c", "empty");
    const at = (slot) => join(root, "stores", slot, "leapsake.db");
    expect(fileState(at("a"))).toBe("plaintext");
    expect(fileState(at("b"))).toBe("encrypted");
    expect(fileState(at("c"))).toBe("empty");
    expect(fileState(at("nothing"))).toBe("absent");
  });
});

describe("custodyUnauthenticated — Flow 1", () => {
  it("passes on a first run that minted nothing", () => {
    expect(custodyUnauthenticated(firstRunTree())).toBeUndefined();
  });

  it("passes when a doors database exists but holds no door", () => {
    // `CREATE TABLE IF NOT EXISTS` runs on every open, read included, so an empty `door`
    // table is a state a correct app reaches. Asserting on the file would go red here.
    const root = firstRunTree();
    writeDoors(root, "local", []);
    expect(custodyUnauthenticated(root)).toBeUndefined();
  });

  it("fails when the Unauthenticated store is ciphertext", () => {
    const root = newRoot();
    writeStore(root, "local", "encrypted");
    expect(custodyUnauthenticated(root)).toMatch(
      /must be plaintext.*ciphertext/s,
    );
  });

  it("fails when the Unauthenticated store was never written", () => {
    const root = newRoot();
    writeStore(root, "local", "empty");
    expect(custodyUnauthenticated(root)).toMatch(/zero bytes/);
  });

  it("fails when there is no store at all", () => {
    expect(custodyUnauthenticated(newRoot())).toMatch(
      /no Unauthenticated store/,
    );
  });

  it("fails when an account survived the reset", () => {
    const root = firstRunTree();
    writeStore(root, ACCOUNT, "encrypted");
    writeDoors(root, ACCOUNT, ["password", "recovery"]);
    writeRoster(root, [account()]);
    const failure = custodyUnauthenticated(root);
    expect(failure).toMatch(/an account store exists on a first run/);
    expect(failure).toMatch(/a db-key door exists on a first run/);
    expect(failure).toMatch(/roster lists 1 account\(s\)/);
  });

  it("reports the key-store row as not asserted", () => {
    const root = newRoot();
    expect(custodyUnauthenticated(root)).toMatch(/key store: not asserted/);
  });
});

describe("custodyAuthenticated — Flow 4", () => {
  it("passes on a converted tree, empty stores/local directory and all", () => {
    const root = convertedTree();
    expect(readdirSync(join(root, "stores", "local"))).toEqual([]);
    expect(custodyAuthenticated(root)).toBeUndefined();
  });

  it("fails when the account's store is plaintext — the encrypting-nothing build", () => {
    const root = convertedTree();
    writeStore(root, ACCOUNT, "plaintext");
    expect(custodyAuthenticated(root)).toMatch(/this build encrypted nothing/);
  });

  it("fails when the plaintext original survived", () => {
    const root = convertedTree();
    writeStore(root, "local", "plaintext");
    expect(custodyAuthenticated(root)).toMatch(
      /stores\/local\/leapsake\.db still exists \(plaintext\)/,
    );
  });

  it("fails when the account's store is missing or unwritten", () => {
    const root = convertedTree();
    writeStore(root, ACCOUNT, "empty");
    expect(custodyAuthenticated(root)).toMatch(/is empty — the conversion/);
  });

  it("fails when only one door was written", () => {
    const root = convertedTree();
    rmSync(join(root, "stores", ACCOUNT, "doors.db"));
    writeDoors(root, ACCOUNT, ["password"]);
    expect(custodyAuthenticated(root)).toMatch(
      /missing door kind\(s\): recovery \(found: password\)/,
    );
  });

  it("fails when the doors table exists but is empty", () => {
    const root = convertedTree();
    rmSync(join(root, "stores", ACCOUNT, "doors.db"));
    writeDoors(root, ACCOUNT, []);
    expect(custodyAuthenticated(root)).toMatch(
      /missing door kind\(s\): password, recovery \(found: none\)/,
    );
  });

  it("fails, and reports nothing else, when the roster does not name one account", () => {
    const root = convertedTree();
    writeRoster(root, [account(), account("acct-second")]);
    const failure = custodyAuthenticated(root);
    expect(failure).toMatch(/holds 2 account\(s\).*expected exactly 1/s);
    // The early return matters: without an id every other check is about a slot nobody
    // claims, and reporting them would bury the one fact that explains the rest.
    expect(failure).not.toMatch(/door kind/);
    expect(failure).not.toMatch(/PLAINTEXT/);
  });

  it("fails when account creation recorded no account", () => {
    const root = convertedTree();
    writeRoster(root, []);
    expect(custodyAuthenticated(root)).toMatch(/holds 0 account\(s\)/);
  });

  it("fails readably on a malformed roster rather than throwing", () => {
    const root = convertedTree();
    writeRoster(root, [], "{not json");
    expect(custodyAuthenticated(root)).toMatch(/not readable JSON/);
  });
});

/** Every path under `root`, for comparing a tree against itself. */
const tree = (root) =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

// The guard against a future refactor reintroducing a bare `new DatabaseSync(path)`, which
// would answer "does the roster exist?" by creating one.
describe("the checks create nothing", () => {
  it("leaves an empty tree untouched", () => {
    const root = newRoot();
    mkdirSync(join(root, "stores"));
    const before = tree(root);
    custodyUnauthenticated(root);
    custodyAuthenticated(root);
    expect(tree(root)).toEqual(before);
  });

  it("leaves a converted tree untouched", () => {
    const root = convertedTree();
    const before = tree(root);
    custodyUnauthenticated(root);
    custodyAuthenticated(root);
    expect(tree(root)).toEqual(before);
  });
});
