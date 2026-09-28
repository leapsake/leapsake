import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const PLUGIN = resolve(import.meta.dirname, "comment-rules.mjs");

/** Rule ids oxlint reports for `source` in file `name`, one per finding. */
const findings = (source, name = "sample.ts") => {
  const dir = mkdtempSync(join(tmpdir(), "comment-rules-"));
  writeFileSync(
    join(dir, ".oxlintrc.json"),
    JSON.stringify({
      categories: { correctness: "off", suspicious: "off" },
      jsPlugins: [PLUGIN],
      rules: {
        "leapsake/max-comment-lines": "error",
        "leapsake/max-comment-width": "error",
        "leapsake/no-decision-comments": "error",
      },
    }),
  );
  writeFileSync(join(dir, name), source);
  const run = spawnSync(
    "pnpm",
    [
      "exec",
      "oxlint",
      "-c",
      join(dir, ".oxlintrc.json"),
      "--format=unix",
      join(dir, name),
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

const words = (columns) => "x".repeat(columns);

const jsxComment = (inner) =>
  `const a = (\n  <div>\n    {/* ${inner} */}\n  </div>\n);\n`;

describe("max-comment-width", () => {
  test("allows a comment line of 80 columns and reports one of 81", () => {
    expect(findings(`// ${words(77)}\nconst a = 1;\n`)).toEqual([]);
    expect(findings(`// ${words(78)}\nconst a = 1;\n`)).toEqual([
      "max-comment-width",
    ]);
  });

  test("counts indentation, a tab reaching the next multiple of four", () => {
    expect(findings(`\t// ${words(73)}\nconst a = 1;\n`)).toEqual([]);
    expect(findings(`\t// ${words(74)}\nconst a = 1;\n`)).toEqual([
      "max-comment-width",
    ]);
  });

  test("counts an emoji as one column", () => {
    expect(findings(`// ${"😀".repeat(77)}\nconst a = 1;\n`)).toEqual([]);
  });

  test("measures each line of a block comment, delimiters included", () => {
    expect(findings(`/*\n * ${words(78)}\n */\nconst a = 1;\n`)).toEqual([
      "max-comment-width",
    ]);
    expect(findings(`/* ${words(75)} */\nconst a = 1;\n`)).toEqual([
      "max-comment-width",
    ]);
  });

  test("leaves a comment after code to the formatter", () => {
    expect(findings(`const a = 1; // ${words(78)}\n`)).toEqual([]);
    expect(findings(`const a = 1; /* ${words(78)}\n */\n`)).toEqual([]);
  });

  test("measures a one-line JSX comment from its brace", () => {
    expect(findings(jsxComment(words(68)), "sample.tsx")).toEqual([]);
    expect(findings(jsxComment(words(69)), "sample.tsx")).toEqual([
      "max-comment-width",
    ]);
  });

  test("exempts a line holding a URL or a disable directive", () => {
    expect(
      findings(`// See https://example.com/${words(78)}\nconst a = 1;\n`),
    ).toEqual([]);
    expect(
      findings(
        `// oxlint-disable-next-line no-console -- ${words(78)}\nconsole.log(1);\n`,
      ),
    ).toEqual([]);
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
