import { describe, expect, it } from "vitest";
import { stickyOrder } from "./sticky-order";

/** A list of rows from their ids, which is all the ordering reads. */
const rows = (...ids: string[]) => ids.map((id) => ({ id }));

/** The resulting order, as ids — what every assertion here is about. */
const idsOf = (result: { id: string }[]) => result.map((r) => r.id);

describe("stickyOrder", () => {
  it("keeps a re-sorted row where it was pinned", () => {
    // `b` was completed, so the natural order sinks it to the tail.
    const natural = rows("a", "c", "d", "b");
    expect(idsOf(stickyOrder(natural, ["a", "b", "c", "d"]))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("is the natural order until something is pinned", () => {
    expect(idsOf(stickyOrder(rows("c", "a", "b"), []))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("drops rows that are gone and ignores pins for rows that aren't there", () => {
    // `b` was deleted or snoozed away while the order was pinned.
    expect(idsOf(stickyOrder(rows("a", "c"), ["a", "b", "c"]))).toEqual([
      "a",
      "c",
    ]);
  });

  it("seats an arrival beside the pinned row it naturally follows", () => {
    // `new` synced in and sorts between `a` and `b`; the pinned rows keep their
    // pinned order around it rather than the newcomer being flushed to the end.
    const natural = rows("a", "new", "b", "c");
    expect(idsOf(stickyOrder(natural, ["a", "c", "b"]))).toEqual([
      "a",
      "new",
      "c",
      "b",
    ]);
  });

  it("keeps an arrival that sorts above everything at the top", () => {
    const natural = rows("new", "a", "b");
    expect(idsOf(stickyOrder(natural, ["a", "b"]))).toEqual(["new", "a", "b"]);
  });

  it("keeps several arrivals in their own natural order", () => {
    const natural = rows("a", "x", "y", "b");
    expect(idsOf(stickyOrder(natural, ["b", "a"]))).toEqual([
      "b",
      "a",
      "x",
      "y",
    ]);
  });

  it("leaves the input untouched", () => {
    const natural = rows("a", "c", "b");
    stickyOrder(natural, ["a", "b", "c"]);
    expect(idsOf(natural)).toEqual(["a", "c", "b"]);
  });
});
