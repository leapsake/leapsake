// The version algebra is the one part of the release path whose mistakes are permanent:
// a store version that goes backwards, or a counter that repeats, cannot be corrected in
// a later release. It is also pure, so it is tested directly rather than through a build.
import { describe, expect, it } from "vitest";

import {
  compareVersions,
  coreOf,
  formatTag,
  highestVersion,
  nextVersion,
  parseTag,
  parseVersion,
  stageOf,
} from "./version.mjs";

describe("parseVersion", () => {
  it("reads a plain version", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("splits a pre-release into its identifiers", () => {
    expect(parseVersion("0.1.0-alpha.2").prerelease).toEqual(["alpha", "2"]);
  });

  it("rejects what set-version.mjs would also reject", () => {
    for (const bad of ["1.2", "v1.2.3", "1.2.3.4", "", "next"]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("coreOf / stageOf", () => {
  it("takes the numeric core the stores see", () => {
    expect(coreOf("0.1.0-rc.4")).toBe("0.1.0");
    expect(coreOf("2.0.0")).toBe("2.0.0");
  });

  it("names the rung, treating a bare version as final", () => {
    expect(stageOf("0.1.0-alpha.1")).toBe("alpha");
    expect(stageOf("0.1.0-rc.1")).toBe("rc");
    expect(stageOf("0.1.0")).toBe("final");
  });

  it("refuses a suffix that is not on the ladder", () => {
    expect(stageOf("0.1.0-nightly.1")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("orders by numeric core first", () => {
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0.0", "0.9.9")).toBe(1);
  });

  it("ranks a pre-release below the release it leads to", () => {
    expect(compareVersions("0.1.0-rc.1", "0.1.0")).toBe(-1);
  });

  it("orders the ladder", () => {
    expect(compareVersions("0.1.0-alpha.9", "0.1.0-beta.1")).toBe(-1);
    expect(compareVersions("0.1.0-beta.9", "0.1.0-rc.1")).toBe(-1);
  });

  it("compares counters numerically, not as strings", () => {
    expect(compareVersions("0.1.0-rc.2", "0.1.0-rc.10")).toBe(-1);
  });

  it("ranks a shorter identifier set below a longer one sharing its prefix", () => {
    expect(compareVersions("0.1.0-rc", "0.1.0-rc.1")).toBe(-1);
  });

  it("is zero on equality", () => {
    expect(compareVersions("0.1.0-beta.3", "0.1.0-beta.3")).toBe(0);
  });
});

describe("tags", () => {
  it("round-trips", () => {
    expect(parseTag(formatTag("0.1.0-beta.1"))).toBe("0.1.0-beta.1");
  });

  it("ignores tags that are not releases", () => {
    expect(parseTag("web-spike-final")).toBeNull();
    expect(parseTag("v-not-a-version")).toBeNull();
  });

  it("finds the highest release among unrelated tags", () => {
    const tags = ["web-spike-final", "v0.1.0-alpha.1", "v0.1.0-rc.2", "backup"];
    expect(highestVersion(tags)).toBe("0.1.0-rc.2");
  });

  it("has no highest when nothing has been released", () => {
    expect(highestVersion(["web-spike-final"])).toBeNull();
  });
});

describe("nextVersion", () => {
  const current = "0.1.0-alpha.1";

  it("starts a rung at .1", () => {
    expect(nextVersion({ current, stage: "alpha", tags: [] })).toBe(
      "0.1.0-alpha.1",
    );
  });

  it("increments the rung it is already on", () => {
    expect(
      nextVersion({ current, stage: "alpha", tags: ["v0.1.0-alpha.1"] }),
    ).toBe("0.1.0-alpha.2");
  });

  it("counts past nine without string-sorting", () => {
    const tags = ["v0.1.0-alpha.9", "v0.1.0-alpha.10"];
    expect(nextVersion({ current, stage: "alpha", tags })).toBe(
      "0.1.0-alpha.11",
    );
  });

  it("carries the core up the ladder and restarts the counter", () => {
    const tags = ["v0.1.0-alpha.1", "v0.1.0-alpha.2"];
    expect(nextVersion({ current, stage: "beta", tags })).toBe("0.1.0-beta.1");
  });

  it("drops the suffix entirely for a final release", () => {
    expect(
      nextVersion({ current, stage: "final", tags: ["v0.1.0-rc.1"] }),
    ).toBe("0.1.0");
  });

  it("counts only tags on the same core", () => {
    const tags = ["v0.1.0-beta.7", "v0.2.0-beta.1"];
    expect(nextVersion({ current: "0.2.0-beta.1", stage: "beta", tags })).toBe(
      "0.2.0-beta.2",
    );
  });

  it("takes an explicit base — the one number a human picks", () => {
    expect(
      nextVersion({ current, stage: "alpha", base: "0.2.0", tags: [] }),
    ).toBe("0.2.0-alpha.1");
  });

  it("refuses a stage that is not on the ladder", () => {
    expect(() => nextVersion({ current, stage: "nightly", tags: [] })).toThrow(
      /unknown stage/,
    );
  });
});
