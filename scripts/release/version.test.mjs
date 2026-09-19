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
  successorCores,
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
  const core = "0.1.0";

  it("starts a channel at .1", () => {
    expect(nextVersion({ core, stage: "alpha", tags: [] })).toBe(
      "0.1.0-alpha.1",
    );
  });

  it("increments the channel it is already on", () => {
    expect(
      nextVersion({ core, stage: "alpha", tags: ["v0.1.0-alpha.1"] }),
    ).toBe("0.1.0-alpha.2");
  });

  it("counts past nine without string-sorting", () => {
    const tags = ["v0.1.0-alpha.9", "v0.1.0-alpha.10"];
    expect(nextVersion({ core, stage: "alpha", tags })).toBe("0.1.0-alpha.11");
  });

  it("counts each channel on its own, so alpha can follow beta", () => {
    const tags = ["v0.1.0-alpha.3", "v0.1.0-beta.9", "v0.1.0-rc.1"];
    expect(nextVersion({ core, stage: "alpha", tags })).toBe("0.1.0-alpha.4");
    expect(nextVersion({ core, stage: "beta", tags })).toBe("0.1.0-beta.10");
    expect(nextVersion({ core, stage: "rc", tags })).toBe("0.1.0-rc.2");
  });

  it("is the bare core for a final release", () => {
    expect(nextVersion({ core, stage: "final", tags: ["v0.1.0-rc.1"] })).toBe(
      "0.1.0",
    );
  });

  it("counts only tags on the same core", () => {
    const tags = ["v0.1.0-beta.7", "v0.2.0-beta.1"];
    expect(nextVersion({ core: "0.2.0", stage: "beta", tags })).toBe(
      "0.2.0-beta.2",
    );
  });

  it("refuses a stage that is not a channel", () => {
    expect(() => nextVersion({ core, stage: "nightly", tags: [] })).toThrow(
      /unknown stage/,
    );
  });
});

describe("successorCores", () => {
  it("offers the three semver allows, and nothing else", () => {
    expect(successorCores("0.1.0")).toEqual({
      patch: "0.1.1",
      minor: "0.2.0",
      major: "1.0.0",
    });
  });

  it("resets the lower parts rather than carrying them", () => {
    // The trap this guards: `0.4.7` → minor is `0.5.0`, never `0.5.7`.
    expect(successorCores("0.4.7")).toEqual({
      patch: "0.4.8",
      minor: "0.5.0",
      major: "1.0.0",
    });
  });

  it("counts past nine numerically", () => {
    expect(successorCores("0.9.9").minor).toBe("0.10.0");
  });
});
