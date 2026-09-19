import { describe, expect, it } from "vitest";

import { coreToWrite, versionProblems } from "./set-version.mjs";

describe("coreToWrite", () => {
  it("computes the core from a bump kind", () => {
    expect(coreToWrite("0.4.7", "patch")).toBe("0.4.8");
    expect(coreToWrite("0.4.7", "minor")).toBe("0.5.0");
    expect(coreToWrite("0.4.7", "major")).toBe("1.0.0");
  });

  it("accepts an explicit core only when it is one of the three successors", () => {
    for (const core of ["0.1.1", "0.2.0", "1.0.0"]) {
      expect(coreToWrite("0.1.0", core)).toBe(core);
    }
  });

  it("refuses a fat-fingered core that would sort above the current one", () => {
    for (const core of ["0.11.0", "1.1.0", "9.9.9"]) {
      expect(() => coreToWrite("0.1.0", core)).toThrow(
        /does not follow 0\.1\.0 — the choices are 0\.1\.1, 0\.2\.0, 1\.0\.0/,
      );
    }
  });

  it("refuses restating or lowering the current core", () => {
    expect(() => coreToWrite("0.2.0", "0.2.0")).toThrow(/does not follow/);
    expect(() => coreToWrite("0.2.0", "0.1.1")).toThrow(/does not follow/);
  });

  it("refuses a pre-release suffix", () => {
    expect(() => coreToWrite("0.1.0", "0.1.1-beta.1")).toThrow(/bare X\.Y\.Z/);
  });
});

const at = (...versions) =>
  versions.map((version, i) => ({ path: `m${i}/package.json`, version }));

describe("versionProblems", () => {
  it("passes manifests that agree on a bare core", () => {
    expect(versionProblems(at("0.1.0", "0.1.0"))).toEqual([]);
  });

  it("names every manifest when they disagree", () => {
    const problems = versionProblems(at("0.1.0", "0.2.0")).join("\n");
    expect(problems).toMatch(/disagree/);
    expect(problems).toMatch(/0\.1\.0 — m0\/package\.json/);
    expect(problems).toMatch(/0\.2\.0 — m1\/package\.json/);
  });

  it("refuses a suffix even when every manifest carries it", () => {
    expect(versionProblems(at("0.1.0-beta.9", "0.1.0-beta.9"))).toEqual([
      expect.stringMatching(/0\.1\.0-beta\.9 is not a bare X\.Y\.Z/),
    ]);
  });
});
