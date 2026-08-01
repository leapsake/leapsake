import { describe, expect, it } from "vitest";
import { type SyncRow, resolveMerge } from "./merge.js";

/** A stand-in domain row: the SyncRow substrate plus a couple of edited fields. */
interface Row extends SyncRow {
  name: string;
  note: string | null;
}

const ID = "11111111-1111-1111-1111-111111111111";

const row = (over: Partial<Row> = {}): Row => ({
  id: ID,
  name: "base",
  note: null,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

/** All orderings of `xs` — used to prove arrival-order independence. */
function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) =>
    permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [
      x,
      ...rest,
    ]),
  );
}

describe("resolveMerge — whole-row LWW", () => {
  it("the higher updatedAt wins", () => {
    const older = row({ name: "old", updatedAt: 1000 });
    const newer = row({ name: "new", updatedAt: 2000 });
    expect(resolveMerge(older, newer)).toBe(newer);
    expect(resolveMerge(newer, older)).toBe(newer);
  });

  it("is commutative", () => {
    const a = row({ name: "a", updatedAt: 2000 });
    const b = row({ name: "b", updatedAt: 1000 });
    expect(resolveMerge(a, b)).toEqual(resolveMerge(b, a));
  });

  it("is idempotent", () => {
    const a = row({ name: "a", updatedAt: 2000 });
    expect(resolveMerge(a, a)).toEqual(a);
  });

  it("breaks an equal-updatedAt tie deterministically, both orders agree", () => {
    const a = row({ name: "alpha", updatedAt: 1500 });
    const b = row({ name: "beta", updatedAt: 1500 });
    // Whatever the winner is, it must not depend on argument order.
    expect(resolveMerge(a, b)).toEqual(resolveMerge(b, a));
    // ...and it must be one of the two inputs, chosen stably.
    expect([a, b]).toContainEqual(resolveMerge(a, b));
  });

  it("throws when the two rows are not the same record", () => {
    const a = row();
    const b = row({ id: "22222222-2222-2222-2222-222222222222" });
    expect(() => resolveMerge(a, b)).toThrow(/different ids/);
  });
});

describe("resolveMerge — convergence (order independence)", () => {
  it("folds any permutation of a batch to the same row", () => {
    // Five concurrent versions of the same record, including same-ms ties and a
    // tombstone. Convergence must hold for every arrival order.
    const versions: Row[] = [
      row({ name: "v1", updatedAt: 1000 }),
      row({ name: "v2", note: "x", updatedAt: 1500 }),
      row({ name: "v3", updatedAt: 1500 }), // ties v2 on updatedAt
      row({ name: "v4", updatedAt: 2000, deletedAt: 2000 }), // a delete
      row({ name: "v5", note: "y", updatedAt: 1800 }),
    ];

    const fold = (xs: Row[]) => xs.reduce((acc, x) => resolveMerge(acc, x));
    const expected = fold(versions);

    for (const order of permutations(versions)) {
      expect(fold(order)).toEqual(expected);
    }
  });
});

describe("resolveMerge — tombstones", () => {
  it("a later delete beats an earlier edit", () => {
    const edit = row({ name: "edited", updatedAt: 1000 });
    const del = row({ name: "edited", updatedAt: 2000, deletedAt: 2000 });
    expect(resolveMerge(edit, del)).toBe(del);
  });

  it("a later edit resurrects over an earlier delete", () => {
    const del = row({ updatedAt: 1000, deletedAt: 1000 });
    const edit = row({ name: "back", updatedAt: 2000 });
    const merged = resolveMerge(del, edit);
    expect(merged).toBe(edit);
    expect(merged.deletedAt).toBeNull();
  });
});

describe("resolveMerge — an untouched row never wins", () => {
  // The stand-in for the real thing: `note` is the field a user's decision lands
  // in, `name` the one the engine re-derives. A row with a note has history.
  const hasHistory = (r: Row) => r.note !== null;

  it("history beats a mint even when the mint is newer", () => {
    const decided = row({ note: "snoozed", updatedAt: 1000 });
    const minted = row({ name: "as minted", updatedAt: 9000 });
    expect(resolveMerge(decided, minted, hasHistory)).toBe(decided);
    expect(resolveMerge(minted, decided, hasHistory)).toBe(decided);
  });

  it("a tombstone survives a peer's fresh mint — the defect this fixes", () => {
    const dismissed = row({
      note: "dismissed",
      updatedAt: 1000,
      deletedAt: 1000,
    });
    const minted = row({ updatedAt: 2000 });
    expect(resolveMerge(dismissed, minted, hasHistory)).toBe(dismissed);
    expect(resolveMerge(minted, dismissed, hasHistory).deletedAt).toBe(1000);
  });

  it("two rows that both carry history stay plain LWW", () => {
    const older = row({ note: "a", updatedAt: 1000 });
    const newer = row({ note: "b", updatedAt: 2000 });
    expect(resolveMerge(older, newer, hasHistory)).toBe(newer);
    expect(resolveMerge(newer, older, hasHistory)).toBe(newer);
  });

  it("two untouched rows stay plain LWW", () => {
    const older = row({ name: "old", updatedAt: 1000 });
    const newer = row({ name: "new", updatedAt: 2000 });
    expect(resolveMerge(older, newer, hasHistory)).toBe(newer);
    expect(resolveMerge(newer, older, hasHistory)).toBe(newer);
  });

  it("changes nothing when no predicate is supplied", () => {
    // The same pair the first case inverts: without the rule, newest wins.
    const decided = row({ note: "snoozed", updatedAt: 1000 });
    const minted = row({ name: "as minted", updatedAt: 9000 });
    expect(resolveMerge(decided, minted)).toBe(minted);
  });

  it("folds any permutation of a mixed batch to the same row", () => {
    // The test that catches a predicate consulting the *pair* rather than the
    // row: such a predicate passes every case above and stops devices
    // converging, which nothing else here would notice.
    const versions: Row[] = [
      row({ name: "mint-1", updatedAt: 3000 }), // newest, but untouched
      row({ name: "mint-2", updatedAt: 2500 }),
      row({ name: "mint-3", updatedAt: 2500 }), // ties mint-2
      row({ note: "snoozed", updatedAt: 1000 }),
      row({ note: "dismissed", updatedAt: 1200, deletedAt: 1200 }),
      row({ note: "reopened", updatedAt: 1200 }), // ties the tombstone
    ];

    const fold = (xs: Row[]) =>
      xs.reduce((acc, x) => resolveMerge(acc, x, hasHistory));
    const expected = fold(versions);

    // A row with history won, not the newest row.
    expect(hasHistory(expected)).toBe(true);
    for (const order of permutations(versions)) {
      expect(fold(order)).toEqual(expected);
    }
  });
});

describe("resolveMerge — the lost-update window (documented cost of whole-row LWW)", () => {
  it("concurrent edits to *different* fields keep only the higher-updatedAt row", () => {
    const base = row({ name: "base", note: null, updatedAt: 1000 });
    // Device A renames; device B (a hair later) adds a note — different fields.
    const deviceA = { ...base, name: "renamed", updatedAt: 2000 };
    const deviceB = { ...base, note: "added", updatedAt: 2001 };

    const merged = resolveMerge(deviceA, deviceB);

    // Whole-row LWW: device B's row wins entirely, so device A's rename is lost.
    expect(merged).toBe(deviceB);
    expect(merged.name).toBe("base"); // the rename did not survive
    expect(merged.note).toBe("added");
  });
});
