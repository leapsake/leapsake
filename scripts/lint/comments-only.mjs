// `[file...]`, else every changed .ts/.tsx/.mjs: exits 1 unless each prints
// as its HEAD version does once TypeScript strips comments.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const printed = (source, name) => {
  const kind = name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  return ts.createPrinter({ removeComments: true }).printFile(file);
};

const headVersion = (path) => {
  try {
    return git("show", `HEAD:${path}`);
  } catch {
    return null;
  }
};

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : git("diff", "--name-only", "HEAD")
        .split("\n")
        .filter((path) => /\.(ts|tsx|mjs)$/.test(path));

let changed = 0;
for (const path of files) {
  const before = headVersion(path);
  const same =
    before !== null &&
    printed(before, path) === printed(readFileSync(path, "utf8"), path);
  if (!same) changed++;
  console.log(`${same ? "comments only" : "CODE CHANGED "}  ${path}`);
}
process.exit(changed === 0 ? 0 : 1);
