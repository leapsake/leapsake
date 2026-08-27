// Every TypeScript test file must belong to some project's tsconfig `include`.
//
// `pnpm test:types` runs `tsc` per workspace, and tsc only sees the files its own
// tsconfig includes. A test directory that sits outside every `include` is therefore
// **not typechecked** — and nothing says so: the suite still runs it, vitest still
// passes it, and its type errors are simply never looked for. The failure is silence,
// which is why this is a test rather than a line in a document asking people to check.
//
// File resolution goes through TypeScript's own `parseJsonConfigFileContent`, so the
// include/exclude semantics here are tsc's rather than an approximation of them.
import { dirname, relative, resolve } from "node:path";
import { glob } from "node:fs/promises";
import { expect, test } from "vitest";
import ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");

// The TS half of vitest's `include` (vitest.config.ts). `scripts/**/*.test.mjs` is
// deliberately absent: it is JavaScript, so no tsconfig would ever claim it.
const TEST_GLOBS = [
  "packages/*/{src,test}/**/*.test.ts",
  "packages/*/{src,test}/**/*.test.tsx",
  "apps/server/{src,test}/**/*.test.ts",
  "apps/desktop/test/**/*.test.ts",
  "apps/mobile/lib/**/*.test.ts",
];

const CONFIG_GLOB = "{apps,packages}/*/tsconfig*.json";

/** Every file tsc would put in this project's program. */
const filesInProject = (configPath) => {
  const raw = ts.readConfigFile(configPath, ts.sys.readFile);
  if (raw.error) throw new Error(`unreadable tsconfig: ${configPath}`);
  const parsed = ts.parseJsonConfigFileContent(
    raw.config,
    ts.sys,
    dirname(configPath),
  );
  return parsed.fileNames.map((f) => relative(repoRoot, resolve(f)));
};

const collect = async (patterns) => {
  const out = new Set();
  for (const pattern of patterns) {
    for await (const f of glob(pattern, { cwd: repoRoot })) out.add(f);
  }
  return out;
};

test("every TypeScript test file is inside some tsconfig's include", async () => {
  const configs = [...(await collect([CONFIG_GLOB]))];
  expect(configs.length).toBeGreaterThan(0);

  const typechecked = new Set();
  for (const c of configs) {
    for (const f of filesInProject(resolve(repoRoot, c))) typechecked.add(f);
  }

  const testFiles = [...(await collect(TEST_GLOBS))].sort();
  expect(testFiles.length).toBeGreaterThan(0);

  const unchecked = testFiles.filter((f) => !typechecked.has(f));
  expect(unchecked).toEqual([]);
});
