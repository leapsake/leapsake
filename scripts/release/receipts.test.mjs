// The receipt is the only record tying a build number back to a commit — Apple will not
// tell you, and the commit baked into the artifact is not reachable over its API. So the
// parsing half is worth testing directly: it reads notes that a human can edit, from a ref
// that no other test touches, and its failures are silent by design.
//
// The git half is exercised by the release path itself; what is pinned here is the format
// and the tolerance, which is where a wrong answer would be *plausible* rather than loud.
import { describe, expect, it } from "vitest";

import { formatReceipt, parseReceipts } from "./receipts.mjs";

const fields = {
  tag: "v0.1.0-rc.2",
  version: "0.1.0-rc.2",
  stage: "rc",
  target: "ios",
  buildNumber: 368500,
  bundleId: "com.leapsake.app",
  at: "2026-09-13T04:00:00.000Z",
};

describe("formatReceipt", () => {
  it("writes one line, so appending never needs to re-read", () => {
    const line = formatReceipt(fields);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({
      tag: "v0.1.0-rc.2",
      version: "0.1.0-rc.2",
      stage: "rc",
      target: "ios",
      build: "368500",
      bundleId: "com.leapsake.app",
      at: "2026-09-13T04:00:00.000Z",
    });
  });

  it("normalizes the build number, which two targets type differently", () => {
    // iOS carries it as a string and Android as a number; a lookup against Apple's answer
    // should not depend on which one wrote the receipt.
    expect(
      JSON.parse(formatReceipt({ ...fields, buildNumber: "368500" })).build,
    ).toBe("368500");
    expect(
      JSON.parse(formatReceipt({ ...fields, buildNumber: 368500 })).build,
    ).toBe("368500");
  });

  it("stamps the time when none is given", () => {
    const { at } = JSON.parse(formatReceipt({ ...fields, at: undefined }));
    expect(Number.isNaN(Date.parse(at))).toBe(false);
  });

  it("refuses a receipt that identifies nothing", () => {
    expect(() => formatReceipt({ ...fields, tag: undefined })).toThrow(/tag/);
    expect(() => formatReceipt({ ...fields, target: undefined })).toThrow(
      /target/,
    );
  });
});

describe("parseReceipts", () => {
  it("reads back what formatReceipt wrote", () => {
    expect(parseReceipts(formatReceipt(fields))).toEqual([
      JSON.parse(formatReceipt(fields)),
    ]);
  });

  it("handles the blank line git notes append inserts between entries", () => {
    // Measured, not assumed: `git notes append` joins entries with a blank line, so the
    // separator is part of the normal shape rather than damage.
    const note = `${formatReceipt(fields)}\n\n${formatReceipt({
      ...fields,
      target: "android",
    })}\n`;
    expect(parseReceipts(note).map((each) => each.target)).toEqual([
      "ios",
      "android",
    ]);
  });

  it("skips a line someone mangled rather than losing the rest", () => {
    // A note is hand-editable and outside the suite's reach. One bad line should cost that
    // line — the caller can still resolve a commit from the good ones.
    const note = [
      formatReceipt(fields),
      "not json at all",
      "{ half an object",
      formatReceipt({ ...fields, target: "android" }),
    ].join("\n\n");
    expect(parseReceipts(note).map((each) => each.target)).toEqual([
      "ios",
      "android",
    ]);
  });

  it("is empty for a commit with no note", () => {
    expect(parseReceipts(null)).toEqual([]);
    expect(parseReceipts("")).toEqual([]);
    expect(parseReceipts("\n\n  \n")).toEqual([]);
  });

  it("ignores JSON that is not an object", () => {
    expect(parseReceipts('"a string"\n\n42\n\nnull')).toEqual([]);
  });
});
