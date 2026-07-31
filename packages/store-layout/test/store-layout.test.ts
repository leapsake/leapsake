import { describe, expect, it } from "vitest";
import {
  type RosterEntry,
  type RosterStorage,
  createAccountRoster,
  resolveActiveStore,
  storePath,
} from "../src/index.js";

/** An in-memory {@link RosterStorage}, standing in for the platform file. */
function memoryStorage(initial?: string): RosterStorage & { text?: string } {
  let text = initial;
  return {
    get text() {
      return text;
    },
    async read() {
      return text;
    },
    async write(next) {
      text = next;
    },
  };
}

const entry = (id: string, username = id): RosterEntry => ({
  id,
  username,
  createdAt: "2026-07-27T00:00:00.000Z",
});

describe("account roster", () => {
  it("reads as empty before anything is written", async () => {
    const roster = createAccountRoster(memoryStorage());
    expect(await roster.list()).toEqual([]);
  });

  it("round-trips accounts through storage", async () => {
    const roster = createAccountRoster(memoryStorage());
    await roster.add(entry("a1", "ada"));
    await roster.add(entry("a2", "grace"));
    expect((await roster.list()).map((a) => a.username)).toEqual([
      "ada",
      "grace",
    ]);
  });

  it("updates in place rather than duplicating a known id", async () => {
    const roster = createAccountRoster(memoryStorage());
    await roster.add(entry("a1", "ada"));
    await roster.add(entry("a1", "ada-renamed"));
    const accounts = await roster.list();
    expect(accounts.length).toBe(1);
    expect(accounts[0].username).toBe("ada-renamed");
  });

  it("removes an account and ignores an unknown one", async () => {
    const roster = createAccountRoster(memoryStorage());
    await roster.add(entry("a1"));
    await roster.add(entry("a2"));
    await roster.remove("a1");
    await roster.remove("nobody");
    expect((await roster.list()).map((a) => a.id)).toEqual(["a2"]);
  });

  // The roster is parsed on the boot path, before any UI exists to report an
  // error, so unreadable content must degrade to "no accounts" (recoverable, and
  // it opens the Unauthenticated store) rather than throw and leave the app unlaunchable.
  it("degrades to empty on corrupt content instead of throwing", async () => {
    for (const corrupt of ["", "   ", "{", "null", "[]", '{"accounts":"no"}']) {
      const roster = createAccountRoster(memoryStorage(corrupt));
      expect(await roster.list()).toEqual([]);
    }
  });

  it("keeps the usable entries when one is malformed", async () => {
    const roster = createAccountRoster(
      memoryStorage(
        JSON.stringify({
          version: 1,
          accounts: [entry("good"), { id: "bad" }],
        }),
      ),
    );
    expect((await roster.list()).map((a) => a.id)).toEqual(["good"]);
  });
});

describe("resolveActiveStore", () => {
  it("opens plaintext when no account exists", () => {
    expect(resolveActiveStore({ accounts: [] })).toEqual({
      custody: "plaintext",
      path: storePath("local"),
    });
  });

  it("is Authenticated at the account's own path once an account exists", () => {
    expect(resolveActiveStore({ accounts: [entry("acct-1")] })).toEqual({
      custody: "encrypted",
      path: storePath("acct-1"),
      accountId: "acct-1",
    });
  });

  it("picks the requested account when the device holds several", () => {
    const resolved = resolveActiveStore({
      accounts: [entry("a1"), entry("a2")],
      activeAccountId: "a2",
    });
    expect(resolved.custody).toBe("encrypted");
    expect(resolved.path).toBe(storePath("a2"));
  });

  it("falls back to the first account when the requested one is gone", () => {
    const resolved = resolveActiveStore({
      accounts: [entry("a1"), entry("a2")],
      activeAccountId: "vanished",
    });
    expect(resolved.path).toBe(storePath("a1"));
  });

  // The Unauthenticated slot is a reserved name, not an account id; ids are UUIDs, so the
  // two can never collide.
  it("never derives the same path for the Unauthenticated slot and an account", () => {
    expect(storePath("local")).not.toBe(storePath("acct-1"));
  });
});
