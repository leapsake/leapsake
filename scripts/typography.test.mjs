// Typographic quotes in user-visible copy, checked rather than remembered.
//
// Every string in the message catalog is text a person reads, so it uses real
// punctuation: `’` for an apostrophe (“Father’s Day”, “can’t”) and `“ ”` for quotation
// marks. A straight `'` or `"` is a typewriter compromise no reader wants, and once one
// lands it tends to breed — the next person matches the surrounding style.
//
// This reads the catalog's AST rather than its text, so it inspects the *values* of
// string and template literals; the quote characters that delimit them are invisible
// here, and apostrophes in code (identifiers, comments) are out of scope.
//
// It lives in `scripts/` rather than beside the catalog because `packages/ui` sets
// `types: []` on purpose — shared UI code must not assume Node — and this check reads a
// file from disk. It is a build-time guard over the repo, in the same shape as
// `tsconfig-coverage.test.mjs`, and the natural place to add the two gaps below.
//
// Not covered, and known: `@leapsake/schema`'s label tables (`genderLabel`, `kindDefs`,
// the role labels) and the strings still inline in `apps/desktop` screens. Both are
// user-visible and both are waiting on the same move into the catalog — see
// `packages/ui/README.md` → *Text*.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import ts from "typescript";

const CATALOG = resolve(
  import.meta.dirname,
  "..",
  "packages/ui/src/messages/en.ts",
);

/** Every string a reader would see: string literals and the text between `${}` holes. */
const userVisibleStrings = (file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found = [];
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      // Skip property keys and import specifiers — neither is read by a user.
      const isKey =
        ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (!isKey && !ts.isImportDeclaration(node.parent)) {
        found.push({
          text: node.text,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

describe("en catalog typography", () => {
  const offendersMatching = (re) =>
    userVisibleStrings(CATALOG)
      .filter((s) => re.test(s.text))
      .map((s) => `en.ts:${s.line} — ${s.text}`);

  test("uses ’ for apostrophes, never a straight quote", () => {
    expect(offendersMatching(/'/)).toEqual([]);
  });

  test("uses “ ” for quotation marks, never a straight double quote", () => {
    expect(offendersMatching(/"/)).toEqual([]);
  });
});
