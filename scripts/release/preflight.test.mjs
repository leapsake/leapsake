import { describe, expect, it } from "vitest";

import { monotonic, tagMatchesManifests } from "./preflight.mjs";

/** A context in the shape `runChecks` passes, defaulting to a healthy local checkout. */
const ctx = (over = {}) => ({
  version: "0.1.0",
  tags: ["v0.1.0-beta.5", "v0.1.0-beta.6"],
  shallow: false,
  firstRelease: false,
  ...over,
});

describe("monotonic", () => {
  it("accepts a version that comes after the highest tag", () => {
    expect(monotonic.check(ctx())).toBeUndefined();
  });

  it("refuses a version that goes backwards", () => {
    expect(monotonic.check(ctx({ version: "0.0.9" }))).toMatch(
      /only ever go forward/,
    );
  });

  it("ignores tags that are not release tags", () => {
    // `web-spike-final` is a real tag in this repository, and exactly the kind of name that
    // would wreck a comparison if it were parsed as a version rather than skipped.
    expect(
      monotonic.check(ctx({ tags: ["web-spike-final", "v0.1.0-beta.6"] })),
    ).toBeUndefined();
  });

  describe("when the tag list cannot be trusted", () => {
    it("refuses a shallow clone, tags or no tags", () => {
      expect(monotonic.check(ctx({ shallow: true }))).toMatch(/shallow/);
    });

    it("refuses a shallow clone even when --first-release is passed", () => {
      // The flag asserts "this repository has never released", which is a claim about
      // history — the one thing a shallow checkout is unable to corroborate.
      expect(
        monotonic.check(ctx({ shallow: true, tags: [], firstRelease: true })),
      ).toMatch(/shallow/);
    });

    it("refuses an empty tag list rather than reading it as a first release", () => {
      const reason = monotonic.check(ctx({ tags: [] }));
      expect(reason).toMatch(/no release tags are visible/);
      // The refusal has to name its own escape hatch, or the only way past it is guessing.
      expect(reason).toMatch(/--first-release/);
    });

    it("accepts an empty tag list when --first-release claims it", () => {
      expect(
        monotonic.check(ctx({ tags: [], firstRelease: true })),
      ).toBeUndefined();
    });
  });

  it("accepts alpha after beta on an open core", () => {
    expect(
      monotonic.check(
        ctx({
          version: "0.1.0-alpha.4",
          tags: ["v0.1.0-alpha.3", "v0.1.0-beta.9"],
        }),
      ),
    ).toBeUndefined();
  });

  it("refuses a lower core than one already tagged", () => {
    expect(
      monotonic.check(
        ctx({ version: "0.1.1-beta.1", tags: ["v0.2.0-alpha.1"] }),
      ),
    ).toMatch(/0\.2\.0 has already been tagged/);
  });

  it("refuses every channel on a core a final has closed", () => {
    const tags = ["v0.1.0-rc.2", "v0.1.0"];
    for (const version of ["0.1.0-alpha.1", "0.1.0-rc.3", "0.1.0"]) {
      const reason = monotonic.check(ctx({ version, tags }));
      expect(reason).toMatch(/0\.1\.0 is closed/);
      expect(reason).toMatch(/set-version\.mjs patch\|minor\|major/);
    }
  });

  it("accepts the next core once the last one is closed", () => {
    expect(
      monotonic.check(
        ctx({ version: "0.1.1-alpha.1", tags: ["v0.1.0-rc.2", "v0.1.0"] }),
      ),
    ).toBeUndefined();
  });
});

describe("tagMatchesManifests", () => {
  it("accepts a tag whose core is the manifests' core", () => {
    for (const version of ["0.1.0-beta.10", "0.1.0"]) {
      expect(
        tagMatchesManifests.check({ version, manifestVersion: "0.1.0" }),
      ).toBeUndefined();
    }
  });

  it("refuses a tag on another core", () => {
    expect(
      tagMatchesManifests.check({
        version: "0.2.0-beta.1",
        manifestVersion: "0.1.0",
      }),
    ).toMatch(/the manifests say 0\.1\.0/);
  });
});
