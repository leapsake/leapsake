import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const PLUGIN = resolve(import.meta.dirname, "comment-rules.mjs");

/** Rule ids oxlint reports for `source`, one per finding, in order. */
const findings = (source) => {
  const dir = mkdtempSync(join(tmpdir(), "comment-rules-"));
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      categories: { correctness: "off", suspicious: "off" },
      jsPlugins: [PLUGIN],
      rules: {
        "leapsake/max-comment-lines": "error",
        "leapsake/no-decision-comments": "error",
      },
    }),
  );
  writeFileSync(join(dir, "sample.ts"), source);
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "oxlint",
      "-c",
      join(dir, ".oxlintrc.json"),
      "--format=unix",
      join(dir, "sample.ts"),
    ],
    { encoding: "utf8" },
  );
  return [...run.stdout.matchAll(/leapsake\(([a-z-]+)\)/g)].map((m) => m[1]);
};

describe("max-comment-lines", () => {
  test("allows two consecutive line comments", () => {
    expect(findings("// one\n// two\nconst a = 1;\n")).toEqual([]);
  });

  test("reports three consecutive line comments once", () => {
    expect(findings("// one\n// two\n// three\nconst a = 1;\n")).toEqual([
      "max-comment-lines",
    ]);
  });

  test("counts a JSDoc block by its prose, not its delimiters", () => {
    expect(
      findings("/**\n * One.\n * Two.\n */\nexport const a = 1;\n"),
    ).toEqual([]);
    expect(
      findings("/**\n * One.\n * Two.\n * Three.\n */\nexport const a = 1;\n"),
    ).toEqual(["max-comment-lines"]);
  });

  test("does not join trailing comments on neighbouring lines", () => {
    expect(
      findings(
        "const a = 1; // one\nconst b = 2; // two\nconst c = 3; // three\n",
      ),
    ).toEqual([]);
  });

  test("a blank line ends a group", () => {
    expect(findings("// one\n// two\n\n// three\nconst a = 1;\n")).toEqual([]);
  });

  test("a disable directive with a reason admits a long comment", () => {
    const source =
      "// oxlint-disable-next-line leapsake/max-comment-lines -- the protocol needs it\n" +
      "// one\n// two\n// three\nconst a = 1;\n";
    expect(findings(source)).toEqual([]);
  });
});

describe("no-decision-comments", () => {
  test.each([
    ["a date", "// Changed on 2026-07-27.\n"],
    ["a § reference", "// See model §7.2.\n"],
    ["a plans/ path", "// See plans/shipping.md.\n"],
    ["an owner attribution", "// Kept (owner, 2026-09-01).\n"],
    ["a slice number", "// Added in slice 4.\n"],
  ])("reports %s", (_, comment) => {
    expect(findings(`${comment}const a = 1;\n`)).toContain(
      "no-decision-comments",
    );
  });

  test("allows a behaviour comment", () => {
    expect(
      findings(
        "// Sort by whichever name part the person has.\nconst a = 1;\n",
      ),
    ).toEqual([]);
  });
});
