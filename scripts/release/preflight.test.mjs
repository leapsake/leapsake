// `monotonic` is the check `preflight.mjs` calls the one that cannot be softened: a store
// version that goes backwards is not fixable in a later release, only abandoned.
//
// Its dangerous failure is not a wrong comparison — that is one line, and obvious when it
// breaks — but an *absent* one. A tag list this process cannot read is indistinguishable
// from a repository that has never released, and both of the checkouts that produce it are
// what a CI runner does by default, on the machine where nobody is watching the output. So
// the empty cases are what carry the weight here, not the arithmetic.
import { describe, expect, it } from "vitest";

import { baseIsSuccessor, monotonic } from "./preflight.mjs";

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

  it("refuses a version equal to one already tagged", () => {
    expect(monotonic.check(ctx({ version: "0.1.0-beta.6" }))).toMatch(
      /does not come after/,
    );
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

  it("names --base when the core has already shipped", () => {
    // Forgetting to start a new train computes a prerelease of a released core. Saying
    // only "does not come after" would leave the reader to infer the remedy.
    const reason = monotonic.check(
      ctx({ version: "0.1.0-alpha.4", tags: ["v0.1.0-alpha.3", "v0.1.0"] }),
    );
    expect(reason).toMatch(/already shipped/);
    expect(reason).toMatch(/--base=patch\|minor\|major/);
  });
});

// The asymmetry this closes: `monotonic` refuses every base that goes backwards and none
// that goes too far forwards — and forwards is the direction that cannot be undone, since
// the stores see the numeric core and an upload spends it permanently.
/** A repository whose 0.1.0 train is finished: the bare tag exists. */
const shipped = (over = {}) => ({
  manifestVersion: "0.1.0-rc.2",
  tags: ["v0.1.0-rc.2", "v0.1.0"],
  ...over,
});

describe("baseIsSuccessor", () => {
  it("has nothing to say when no base was passed", () => {
    expect(baseIsSuccessor.check(shipped({ base: undefined }))).toBeUndefined();
  });

  it("waves through a bump kind, which was computed rather than typed", () => {
    for (const base of ["patch", "minor", "major"]) {
      expect(baseIsSuccessor.check(shipped({ base }))).toBeUndefined();
    }
  });

  it("accepts each of the three cores semver allows next", () => {
    for (const base of ["0.1.1", "0.2.0", "1.0.0"]) {
      expect(baseIsSuccessor.check(shipped({ base }))).toBeUndefined();
    }
  });

  it("refuses a fat-fingered core that monotonic would have allowed", () => {
    // `0.11.0` and `1.1.0` both sort *above* 0.1.0, so nothing else in the file objects.
    for (const base of ["0.11.0", "1.1.0", "9.9.9"]) {
      const reason = baseIsSuccessor.check(shipped({ base }));
      expect(reason).toMatch(/is not where this can go next/);
      expect(reason).toMatch(/0\.1\.1, 0\.2\.0, 1\.0\.0/);
    }
  });

  it("refuses re-releasing a core that already shipped", () => {
    expect(baseIsSuccessor.check(shipped({ base: "0.1.0" }))).toMatch(
      /already released/,
    );
  });

  it("allows restating the core of a train still in progress", () => {
    // Pre-GA the manifests sit on 0.1.0 with no bare tag: naming it again is a no-op.
    expect(
      baseIsSuccessor.check({
        base: "0.1.0",
        manifestVersion: "0.1.0-beta.7",
        tags: ["v0.1.0-beta.7"],
      }),
    ).toBeUndefined();
  });

  it("still bounds the jump while a train is in progress", () => {
    expect(
      baseIsSuccessor.check({
        base: "1.1.0",
        manifestVersion: "0.1.0-beta.7",
        tags: ["v0.1.0-beta.7"],
      }),
    ).toMatch(/the train in progress/);
  });
});
