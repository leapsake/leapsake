// More than one `await` in one branch of a ternary — a shape Hermes miscompiles.
//
// **What goes wrong.** Hermes throws the branch's value away and returns a leftover
// register in its place — a plain number in every instance measured. That is worse
// than a crash: the wrong value is typed as the right one, so it flows through
// bucketing and rendering until something finally reads a property off it, a long
// way from the two lines that produced it.
//
// It landed in `core.reminders.listInWindow`, whose join read
//
//     r.materialized
//       ? { ...r, tags: await tags.listForEntity("reminder", r.id),
//                 mentions: await resolveMentions(r.id) }
//       : { ...r, tags: [], mentions: [] }
//
// On iOS every *stored* reminder came back as `0`. `partitionReminders` files a row
// whose `completedAt` is `undefined` under completed (`undefined !== null` is true),
// so mobile Home lost every real reminder and grew a phantom row in a Completed
// section that crashed on expand, `reminderLabel` reading `title` off a number.
//
// **Why this is a source scan and not an execution.** Nothing under `vitest` can
// observe the bug — Node compiles the same source correctly, and so does the desktop
// bundler, which is why the whole unit and integration suite stayed green while the
// mobile home screen was empty. The only tier that *runs* it is
// `pnpm test:e2e --platform=ios`, and Flow 1 asserts an onboarding nudge on Home — a
// stored row, so it is exactly the assertion this destroys; but that tier is a device
// away from the cause and costs minutes rather than milliseconds. A scan is the lowest
// tier that can hold the rule at all, and it names the reason at the point of the
// mistake.
//
// **Why the bound is "more than one" rather than "any".** A single `await` in a
// branch compiles correctly — measured on the simulator, iOS 18.3 / React Native
// 0.85.3, alongside the two-`await` form that does not — and the app has a dozen
// honest single-`await` ternaries (`app/add.tsx` picking a person or a pet, for one).
// Above one, which allocations survive is not something to reason about: a
// three-`await` branch came out right and a four-`await` branch came out as `3`. So
// this is a flat ban on the shape, not a count someone should try to tune. The fix is
// always the same and never costs anything — hoist the awaits into `const`s, or use
// an `if`; statement form is correct at every count.
//
// **Scope is what Metro compiles**: `apps/mobile`, plus the shared `packages/*`,
// which ship TypeScript source (`"exports": { ".": "./src/index.ts" }`) and so are
// compiled by Hermes too. `apps/desktop` is out of scope — it never meets Hermes —
// and tests are out of scope everywhere, since they only ever run under Node.
//
// It lives in `scripts/` rather than beside either client for the same reason
// `typography.test.mjs` does: it reads files from disk, and neither the mobile app's
// tsconfig nor the packages' may assume Node.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import ts from "typescript";

const REPO = resolve(import.meta.dirname, "..");

/** The most `await`s one branch of a conditional expression may contain. */
const MAX_AWAITS_PER_BRANCH = 1;

/** Every source file Metro compiles into the mobile bundle. */
const bundledSources = () =>
  execFileSync("git", ["ls-files", "-z", "apps/mobile", "packages"], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test."));

/**
 * The `await`s this branch evaluates itself. A nested function is skipped: it has
 * its own async scope and is compiled as its own function, so an `await` inside it
 * is not in this branch's expression at all.
 */
const awaitsIn = (branch) => {
  let count = 0;
  const walk = (node) => {
    if (ts.isAwaitExpression(node)) count++;
    if (ts.isFunctionLike(node)) return;
    ts.forEachChild(node, walk);
  };
  walk(branch);
  return count;
};

const offencesIn = (file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(REPO, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found = [];
  const visit = (node) => {
    if (ts.isConditionalExpression(node))
      for (const branch of [node.whenTrue, node.whenFalse]) {
        const count = awaitsIn(branch);
        if (count > MAX_AWAITS_PER_BRANCH)
          found.push(
            `${file}:${
              source.getLineAndCharacterOfPosition(branch.getStart()).line + 1
            } — ${count} awaits in one ternary branch`,
          );
      }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

describe("Hermes: await inside a conditional expression", () => {
  test("no ternary branch in the mobile bundle holds more than one await", () => {
    const files = bundledSources();
    // A guard that silently scans nothing is worse than no guard: prove it found the
    // tree before asserting anything about what is in it.
    expect(files.length).toBeGreaterThan(100);
    expect(files.flatMap(offencesIn)).toEqual([]);
  });
});
