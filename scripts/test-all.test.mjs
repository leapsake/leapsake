import { describe, expect, it } from "vitest";

import { TIERS, argsFor, selectTiers } from "./test-all.mjs";

const keys = (options) =>
  selectTiers(TIERS, { only: null, fast: false, platforms: null, ...options })
    .map((tier) => tier.key)
    .filter((key) => ["native-android", "native-ios", "e2e"].includes(key));
const tier = (key) => TIERS.find((each) => each.key === key);

describe("--platforms", () => {
  it("keeps every device tier when absent", () => {
    expect(keys({})).toEqual(["native-android", "native-ios", "e2e"]);
  });

  it("drops the other platform's device tiers", () => {
    expect(keys({ platforms: new Set(["ios"]) })).toEqual([
      "native-ios",
      "e2e",
    ]);
    expect(keys({ platforms: new Set(["android"]) })).toEqual([
      "native-android",
      "e2e",
    ]);
  });

  it("never drops a tier that is not per-platform", () => {
    const all = selectTiers(TIERS, { platforms: new Set(["ios"]) });
    expect(all.map((each) => each.key)).toEqual(
      expect.arrayContaining(["format", "lint", "typecheck", "node"]),
    );
  });

  it("narrows e2e to the one platform listed", () => {
    expect(argsFor(tier("e2e"), { platforms: new Set(["ios"]) })).toEqual([
      "--platform=ios",
    ]);
  });

  it("leaves e2e on both platforms when both are listed", () => {
    const platforms = new Set(["ios", "android"]);
    expect(argsFor(tier("e2e"), { platforms })).toEqual([]);
    expect(argsFor(tier("e2e"), { platforms: null })).toEqual([]);
  });

  it("keeps a native tier's own platform and adds --provision", () => {
    expect(
      argsFor(tier("native-ios"), {
        platforms: new Set(["ios"]),
        provision: true,
      }),
    ).toEqual(["--platform=ios", "--provision"]);
  });
});
