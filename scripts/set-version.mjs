// The one place a version number is written, and the gate that keeps it that way.
//
// Every manifest in the workspace carries the *same* version, on purpose: the apps
// because a release is one artifact set, and the packages because a matching version
// across all of them is what says "these library versions are the ones that shipped
// together and are proven together by the suite". It also leaves the door open to
// publishing any package later without first untangling a versioning scheme.
//
// Two jobs, one file:
//
//   node scripts/set-version.mjs 0.1.0    write that version into every manifest
//   node scripts/set-version.mjs --check  fail if they disagree (the `test:versions` tier)
//
// The check half is the point. A bump that misses one manifest is invisible until an
// artifact ships with the wrong number on it — and store version strings are permanent
// and monotonic, so "we'll fix it next release" is not available (plans/v0-1.md).
//
// Manifests are *discovered*, never listed, so a new package or app is covered the day
// it is created rather than the day someone remembers this file exists.
//
// Mobile is deliberately absent from the write set: `apps/mobile/app.json` no longer
// carries a version at all. `apps/mobile/app.config.ts` derives it from that app's
// package.json, so Expo has one source rather than a copy to drift. The check enforces
// that arrangement instead of the value.
//
// A pre-release suffix (`0.1.0-alpha.1`) is valid here and is the normal state between
// releases. Stores reject non-numeric version strings, so app.config.ts strips the
// suffix for `expo.version` and derives the per-upload build numbers separately — the
// repo keeps real semver, the stores see `0.1.0`.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every `package.json` whose version participates: the root plus one per workspace. */
function manifestPaths() {
  const paths = [join(ROOT, "package.json")];
  for (const group of ["apps", "packages"]) {
    const dir = join(ROOT, group);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = join(dir, entry.name, "package.json");
      try {
        readFileSync(manifest);
        paths.push(manifest);
      } catch {
        // A directory without a package.json is not a workspace; skip it.
      }
    }
  }
  return paths;
}

/** Read a manifest, keeping the raw text so a write can preserve its formatting. */
function readManifest(path) {
  const text = readFileSync(path, "utf8");
  return { path, text, json: JSON.parse(text) };
}

/**
 * Rewrite just the `version` value, in place, by string surgery rather than
 * re-serializing. Re-serializing would reformat whatever the file's own style is and
 * make the diff of a version bump unreadable.
 */
function withVersion(text, version) {
  const pattern = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!pattern.test(text)) {
    throw new Error('no top-level "version" field to replace');
  }
  return text.replace(pattern, `$1"${version}"`);
}

const MOBILE_APP_JSON = join(ROOT, "apps", "mobile", "app.json");
const MOBILE_APP_CONFIG = join(ROOT, "apps", "mobile", "app.config.ts");

/**
 * Mobile's arrangement, checked structurally: `app.json` must *not* carry a version or
 * a build number, and `app.config.ts` must exist to derive them. Together these say
 * "there is exactly one place each of these comes from". Reinstating any of them in
 * app.json would silently win back a second source, so it fails the check.
 */
function mobileProblems() {
  const problems = [];
  const appJson = JSON.parse(readFileSync(MOBILE_APP_JSON, "utf8"));
  if (appJson.expo?.version !== undefined) {
    problems.push(
      `${relative(ROOT, MOBILE_APP_JSON)} carries expo.version — it must come from ` +
        "app.config.ts (which reads the app's package.json) so there is one source",
    );
  }
  // Static build numbers are the failure this is guarding against: app.json wins over
  // nothing (app.config.ts overrides it), so a stale number here would look
  // authoritative while doing nothing — or worse, get edited instead of the derivation.
  for (const [platform, field] of [
    ["ios", "buildNumber"],
    ["android", "versionCode"],
  ]) {
    if (appJson.expo?.[platform]?.[field] !== undefined) {
      problems.push(
        `${relative(ROOT, MOBILE_APP_JSON)} carries ${platform}.${field} — build ` +
          "numbers are derived per-upload in app.config.ts, not pinned here",
      );
    }
  }
  try {
    readFileSync(MOBILE_APP_CONFIG);
  } catch {
    problems.push(
      `${relative(ROOT, MOBILE_APP_CONFIG)} is missing — nothing supplies the Expo version`,
    );
  }
  return problems;
}

const arg = process.argv[2];

if (arg === "--check") {
  const manifests = manifestPaths().map(readManifest);
  const byVersion = new Map();
  for (const { path, json } of manifests) {
    const list = byVersion.get(json.version) ?? [];
    list.push(relative(ROOT, path));
    byVersion.set(json.version, list);
  }

  const problems = mobileProblems();
  if (byVersion.size > 1) {
    problems.push("manifests disagree on the version:");
    for (const [version, paths] of [...byVersion].sort()) {
      problems.push(`  ${version} — ${paths.join(", ")}`);
    }
  }

  if (problems.length > 0) {
    console.error("✗ version check failed\n");
    for (const problem of problems) console.error(problem);
    console.error(
      "\nFix with: node scripts/set-version.mjs <version>  (writes every manifest)",
    );
    process.exit(1);
  }
  console.log(
    `✓ ${manifests.length} manifests all at ${[...byVersion.keys()][0]}; ` +
      "Expo reads its version from apps/mobile/package.json",
  );
  process.exit(0);
}

if (arg === undefined || arg.startsWith("-")) {
  console.error("usage: set-version.mjs <version> | --check");
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(arg)) {
  console.error(
    `✗ "${arg}" is not a valid version (expected X.Y.Z or X.Y.Z-suffix)`,
  );
  process.exit(1);
}
if (arg.includes("-")) {
  // Not a warning: the suffix is supported on purpose. Both stores reject a
  // non-numeric version string, so `apps/mobile/app.config.ts` strips the suffix when
  // it derives `expo.version` — the repo runs on real semver and the stores see the
  // numeric core. Said out loud here because the number a build carries then differs
  // from the one in package.json, and that should never be a surprise at upload time.
  const [numeric] = arg.split("-");
  console.log(
    `  (pre-release: stores will see ${numeric}; the suffix stays repo-side)`,
  );
}

for (const { path, text } of manifestPaths().map(readManifest)) {
  writeFileSync(path, withVersion(text, arg));
  console.log(`  ${relative(ROOT, path)}`);
}
console.log(`✓ set ${arg} across every manifest`);
