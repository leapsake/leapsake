import type { DuplicateCandidate } from "@leapsake/data";
import { describe, expect, it } from "vitest";
import { selectJoinDuplicates } from "../src/sync.js";

/**
 * The pure half of reconcile-on-join (reconciliation Increment C): from the
 * candidate pairs detection found across the post-join database, keep only the
 * ones the join *introduced* — exactly one side is a pre-existing local person.
 * Pre-existing local↔local and account↔account pairs are not what joining
 * surfaced, so they are excluded from the "review these" prompt.
 */
describe("selectJoinDuplicates", () => {
  const candidate = (
    aId: string,
    bId: string,
    tier: DuplicateCandidate["tier"] = "medium",
  ): DuplicateCandidate => ({
    a: { id: aId, name: `name-${aId}` },
    b: { id: bId, name: `name-${bId}` },
    tier,
    reasons: ["same name"],
  });

  it("keeps a pair that straddles the local/account boundary", () => {
    const local = new Set(["local-1"]);
    const candidates = [candidate("local-1", "account-1")];
    expect(selectJoinDuplicates(candidates, local)).toEqual(candidates);
  });

  it("is order-independent — the local id may be on either side", () => {
    const local = new Set(["local-1"]);
    expect(
      selectJoinDuplicates([candidate("account-1", "local-1")], local),
    ).toHaveLength(1);
    expect(
      selectJoinDuplicates([candidate("local-1", "account-1")], local),
    ).toHaveLength(1);
  });

  it("excludes pre-existing local↔local pairs", () => {
    const local = new Set(["local-1", "local-2"]);
    expect(
      selectJoinDuplicates([candidate("local-1", "local-2")], local),
    ).toEqual([]);
  });

  it("excludes account↔account pairs", () => {
    const local = new Set(["local-1"]);
    expect(
      selectJoinDuplicates([candidate("account-1", "account-2")], local),
    ).toEqual([]);
  });

  it("counts each cross-set pair once across a mixed batch (high or medium)", () => {
    const local = new Set(["local-1", "local-2"]);
    const crossA = candidate("local-1", "account-1", "high");
    const crossB = candidate("account-2", "local-2", "medium");
    const localLocal = candidate("local-1", "local-2");
    const accountAccount = candidate("account-1", "account-2");
    const selected = selectJoinDuplicates(
      [crossA, localLocal, crossB, accountAccount],
      local,
    );
    expect(selected).toEqual([crossA, crossB]);
  });
});
