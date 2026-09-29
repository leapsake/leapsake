// `<electron|node>`: re-extracts the SQLite prebuild for the runtime about to
// load it. See `AGENTS.md` → _The native SQLite ABI_.
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
