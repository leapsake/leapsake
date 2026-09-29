// Fails unless the renderer bundle has exactly one react and one react-dom, per
// its sourcemap's sources: two copies in one bundle crash every hook call.
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

// Each react and react-dom source's package root, absolute, so two spellings
// of one directory dedupe.
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
      "dependency resolved its own nested React copy. Every workspace package.json\n" +
      "should declare react and react-dom as `catalog:`, and nothing should pin\n" +
      'another version; see ../README.md → "One React, pinned in the catalog".',
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
