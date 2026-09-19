// Writes the one version every manifest carries, and checks that they agree.
//
//   node scripts/set-version.mjs patch|minor|major|X.Y.Z   move every manifest to the next core
//   node scripts/set-version.mjs --check                   fail if they disagree (`test:versions`)
//
// Manifests hold only the core (`0.1.0`); the release tag carries the channel and counter.
// Mobile takes its version from its package.json through `apps/mobile/app.config.ts`.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUMP_KINDS, successorCores } from "./release/version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Workspaces deliberately outside the version set, as `<group>/<name>`.
 *
 * The website deploys on **push**, not on tag, and ships no artifact whose number a
 * store records permanently. Conscripting it into the release version would put a
 * marketing typo fix behind a version bump — reintroducing exactly the coupling
 * `apps/website/README.md` explains the site exists without.
 *
 * An entry here is a claim that has to stay true, so `unversionedProblems()` checks
 * it: the manifest must exist and must *not* carry a version. Deleting the workspace
 * or quietly giving it a version both fail the check rather than rotting silently.
 */
const UNVERSIONED = new Set(["apps/website"]);

/** Every `package.json` whose version participates: the root plus one per workspace. */
function manifestPaths() {
  const paths = [join(ROOT, "package.json")];
  for (const group of ["apps", "packages"]) {
    const dir = join(ROOT, group);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (UNVERSIONED.has(`${group}/${entry.name}`)) continue;
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

/**
 * The other half of UNVERSIONED: an opt-out is a claim, and this is what keeps it
 * true. A workspace named there must still exist and must still carry no version —
 * so the exclusion cannot outlive the workspace, and a version cannot creep back in
 * and sit there looking authoritative while nothing maintains it.
 */
function unversionedProblems() {
  const problems = [];
  for (const workspace of UNVERSIONED) {
    const manifest = join(ROOT, workspace, "package.json");
    let json;
    try {
      json = JSON.parse(readFileSync(manifest, "utf8"));
    } catch {
      problems.push(
        `${workspace} is listed as unversioned but has no package.json — remove it ` +
          "from UNVERSIONED in this file if the workspace is gone",
      );
      continue;
    }
    if (json.version !== undefined) {
      problems.push(
        `${relative(ROOT, manifest)} carries a version (${json.version}) but is ` +
          "listed as unversioned — drop the field, or remove the workspace from " +
          "UNVERSIONED so the check covers it like every other manifest",
      );
    }
  }
  return problems;
}

const CORE = /^\d+\.\d+\.\d+$/;

/** The core a request names: a bump kind, or an explicit `X.Y.Z` that is one of the three successors. */
export function coreToWrite(current, request) {
  const successors = successorCores(current);
  if (BUMP_KINDS.includes(request)) return successors[request];
  if (!CORE.test(request)) {
    throw new Error(
      `"${request}" is not ${BUMP_KINDS.join("|")} or a bare X.Y.Z — manifests carry only the core; the tag carries the rest`,
    );
  }
  if (!Object.values(successors).includes(request)) {
    throw new Error(
      `${request} does not follow ${current} — the choices are ${Object.values(successors).join(", ")} (or name the kind: ${BUMP_KINDS.join("|")})`,
    );
  }
  return request;
}

/** Problems with the manifests' versions, given `{ path, version }` for each. */
export function versionProblems(manifests) {
  const byVersion = new Map();
  for (const { path, version } of manifests) {
    const list = byVersion.get(version) ?? [];
    list.push(path);
    byVersion.set(version, list);
  }
  const problems = [];
  if (byVersion.size > 1) {
    problems.push("manifests disagree on the version:");
    for (const [version, paths] of [...byVersion].sort()) {
      problems.push(`  ${version} — ${paths.join(", ")}`);
    }
  }
  for (const version of byVersion.keys()) {
    if (!CORE.test(version ?? "")) {
      problems.push(
        `${version} is not a bare X.Y.Z — manifests carry only the core; the release tag carries the channel`,
      );
    }
  }
  return problems;
}

function check() {
  const manifests = manifestPaths()
    .map(readManifest)
    .map(({ path, json }) => ({
      path: relative(ROOT, path),
      version: json.version,
    }));
  const problems = [
    ...mobileProblems(),
    ...unversionedProblems(),
    ...versionProblems(manifests),
  ];
  if (problems.length > 0) {
    console.error("✗ version check failed\n");
    for (const problem of problems) console.error(problem);
    console.error(
      "\nFix with: node scripts/set-version.mjs patch|minor|major  (writes every manifest)",
    );
    return 1;
  }
  console.log(
    `✓ ${manifests.length} manifests all at ${manifests[0].version}; ` +
      "Expo reads its version from apps/mobile/package.json" +
      (UNVERSIONED.size > 0
        ? `; unversioned: ${[...UNVERSIONED].join(", ")}`
        : ""),
  );
  return 0;
}

function write(request) {
  const current = readManifest(join(ROOT, "package.json")).json.version;
  let core;
  try {
    core = coreToWrite(current, request);
  } catch (error) {
    console.error(`✗ ${error.message}`);
    return 1;
  }
  for (const { path, text } of manifestPaths().map(readManifest)) {
    writeFileSync(path, withVersion(text, core));
    console.log(`  ${relative(ROOT, path)}`);
  }
  console.log(`✓ set ${core} across every manifest`);
  return 0;
}

function main(arg) {
  if (arg === "--check") return check();
  if (arg === undefined || arg.startsWith("-")) {
    console.error(
      `usage: set-version.mjs ${BUMP_KINDS.join("|")}|X.Y.Z | --check`,
    );
    return 1;
  }
  return write(arg);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv[2]));
}
