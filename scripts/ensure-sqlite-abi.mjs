// Ensure the `better-sqlite3-multiple-ciphers` native binary matches the runtime
// that is about to load it.
//
// It is a single prebuilt `.node` file that can only carry one ABI at a time:
// the Electron desktop app and Node (Vitest) require *different* ABIs, so running
// one flips the binary out from under the other ("compiled against a different
// Node.js version" / NODE_MODULE_VERSION mismatch). This re-extracts the correct
// prebuilt binary via `prebuild-install`, which after the first download is an
// instant, offline copy from its local cache (no node-gyp compile).
//
// Wired into `pnpm test` (node) and the desktop `dev`/`start` scripts (electron)
// so the two can be used interchangeably without a manual rebuild. The Electron
// version is derived from the installed package, so bumping Electron needs no edit
// here.
//
// Usage: node scripts/ensure-sqlite-abi.mjs <electron|node>
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const runtime = process.argv[2];
if (runtime !== "electron" && runtime !== "node") {
  console.error("usage: ensure-sqlite-abi.mjs <electron|node>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const moduleDir = dirname(
  require.resolve("better-sqlite3-multiple-ciphers/package.json"),
);

const args = ["prebuild-install", "--force"];
if (runtime === "electron") {
  const { version } = require("electron/package.json");
  args.push("--runtime", "electron", "--target", version);
}

console.log(`ensuring better-sqlite3 native binary for ${runtime}…`);
execFileSync("pnpm", ["exec", ...args], { cwd: moduleDir, stdio: "inherit" });
