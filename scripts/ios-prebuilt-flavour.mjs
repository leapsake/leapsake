// Before a Debug iOS build, finds prebuilt pods whose simulator binary is not
// their Debug tarball's; if any, deletes `ios/` for `expo run:ios` to rebuild.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = join(ROOT, "apps", "mobile", "ios");
const DERIVED_DATA = join(
  homedir(),
  "Library",
  "Developer",
  "Xcode",
  "DerivedData",
);

const SIMULATOR_BINARY = /ios-arm64_x86_64-simulator\/([^/]+)\.framework\/\1$/;

/** Every Debug tarball: React Native's in `Pods/<Name>-artifacts/`, Expo's in
 *  `Pods/<Pod>/artifacts/`. */
function debugTarballs(podsDir) {
  return readdirSync(podsDir, { recursive: true })
    .map(String)
    .filter((path) => /(^|\/|-)artifacts\/[^/]+-debug\.tar\.gz$/.test(path))
    .map((path) => join(podsDir, path));
}

function tar(args) {
  const run = spawnSync("tar", args, { maxBuffer: 2 ** 30 });
  if (run.status !== 0) throw new Error(`tar ${args.join(" ")}: ${run.stderr}`);
  return run.stdout;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Installed simulator binaries keyed by `<slice>/<Name>.framework/<Name>`,
 *  since a pod may unpack its tarball under a different prefix. */
function installedBinaries(podsDir) {
  const byTail = new Map();
  for (const path of readdirSync(podsDir, { recursive: true }).map(String)) {
    if (SIMULATOR_BINARY.test(path))
      byTail.set(tail(path), join(podsDir, path));
  }
  return byTail;
}

const tail = (path) => path.split("/").slice(-3).join("/");

/** Debug tarballs whose simulator binary differs from the installed one. A
 *  tarball with no simulator binary, or none installed, is skipped. */
export function nonDebugPrebuilts(podsDir) {
  const installed = installedBinaries(podsDir);
  const stale = [];
  for (const tarball of debugTarballs(podsDir)) {
    const member = tar(["-tzf", tarball])
      .toString()
      .split("\n")
      .find((path) => SIMULATOR_BINARY.test(path));
    const copy = member && installed.get(tail(member));
    if (!copy) continue;
    if (
      sha256(readFileSync(copy)) !== sha256(tar(["-xzOf", tarball, member]))
    ) {
      stale.push(basename(tarball, "-debug.tar.gz"));
    }
  }
  return stale;
}

function main() {
  const podsDir = join(IOS, "Pods");
  if (!existsSync(podsDir)) return;
  const stale = nonDebugPrebuilts(podsDir);
  if (stale.length === 0) return;

  console.log(
    `ios/Pods holds non-Debug builds of ${stale.join(", ")}, left by a Release build.\n` +
      "Deleting ios/ and Leapsake's DerivedData so expo run:ios regenerates them.",
  );
  rmSync(IOS, { recursive: true, force: true });
  if (existsSync(DERIVED_DATA)) {
    for (const entry of readdirSync(DERIVED_DATA)) {
      if (entry.startsWith("Leapsake-")) {
        rmSync(join(DERIVED_DATA, entry), { recursive: true, force: true });
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
