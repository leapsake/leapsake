// Regression guard: the renderer bundle must contain exactly ONE React and ONE
// react-dom. React's hook dispatcher is a module-level singleton, so a second
// physical copy (classically pulled in by a transitive dep like
// react-router-dom that resolves its own nested React) yields "Invalid hook
// call" / null-dispatcher crashes — a white screen at runtime, with a clean
// build. See AGENTS.md "React version policy (monorepo)".
//
// We assert against the built sourcemap because that lists every source module
// actually included, which is the only faithful signal: Node/default resolution
// can legitimately see two React paths on disk (see the comment in
// electron.vite.config.ts); what matters is that the BUNDLE collapses to one,
// which is the job of `renderer.resolve.dedupe`.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { relative, resolve } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(appRoot, "out/renderer/assets");

// Build fresh with sourcemaps so the check never reads a stale artifact.
rmSync(resolve(appRoot, "out/renderer"), { recursive: true, force: true });
execFileSync("pnpm", ["exec", "electron-vite", "build", "--sourcemap"], {
  cwd: appRoot,
  stdio: ["ignore", "ignore", "inherit"],
});

const mapFile = readdirSync(outDir).find((f) => f.endsWith(".js.map"));
if (!mapFile) {
  console.error("check-single-react: no renderer sourcemap was produced");
  process.exit(1);
}
const map = JSON.parse(readFileSync(resolve(outDir, mapFile), "utf8"));

// Collapse each react / react-dom source file to its package root, resolved to
// an absolute path so two different relative spellings of the same directory
// (e.g. from differing nesting depths) dedupe to one entry.
const reactRoots = new Set();
const reactDomRoots = new Set();
for (const source of map.sources) {
  const abs = resolve(outDir, source);
  let m;
  if ((m = abs.match(/^(.*\/node_modules\/react)\/.+\.js$/))) {
    reactRoots.add(m[1]);
  } else if ((m = abs.match(/^(.*\/node_modules\/react-dom)\/.+\.js$/))) {
    reactDomRoots.add(m[1]);
  }
}

const problems = [];
if (reactRoots.size !== 1) {
  problems.push(
    `expected exactly 1 react copy in the bundle, found ${reactRoots.size}:`,
    ...[...reactRoots].map((r) => `  - ${r}`),
  );
}
if (reactDomRoots.size !== 1) {
  problems.push(
    `expected exactly 1 react-dom copy in the bundle, found ${reactDomRoots.size}:`,
    ...[...reactDomRoots].map((r) => `  - ${r}`),
  );
}

if (problems.length > 0) {
  console.error("check-single-react: FAILED\n" + problems.join("\n"));
  console.error(
    "\nThe renderer bundled more than one React instance. This usually means a\n" +
      "transitive dep resolved its own React copy. Ensure `renderer.resolve.dedupe`\n" +
      "in electron.vite.config.ts lists react/react-dom, and that react and\n" +
      "react-dom are pinned to the same exact version in package.json.",
  );
  process.exit(1);
}

const repoRoot = resolve(appRoot, "../..");
console.log(
  `check-single-react: OK — 1 react (${relative(
    repoRoot,
    [...reactRoots][0],
  )}), 1 react-dom`,
);
