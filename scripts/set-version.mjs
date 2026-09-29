// Writes the core version every manifest carries (`patch|minor|major|X.Y.Z`),
// or with `--check` fails if they disagree.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BUMP_KINDS, successorCores } from "./release/version.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Workspaces outside the version set: the website deploys on push, not tag;
 *  see its README. `unversionedProblems` keeps this true. */
const UNVERSIONED = new Set(["apps/website"]);

/** Every participating `package.json`: the root and each workspace. */
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
        // No package.json, no workspace.
      }
    }
  }
  return paths;
}

/** Reads a manifest, keeping its raw text so a write keeps its formatting. */
function readManifest(path) {
  const text = readFileSync(path, "utf8");
  return { path, text, json: JSON.parse(text) };
}

/** Rewrites only the `version` value in place, so a bump's diff stays one
 *  line. */
function withVersion(text, version) {
  const pattern = /^(\s*"version"\s*:\s*)"[^"]*"/m;
  if (!pattern.test(text)) {
    throw new Error('no top-level "version" field to replace');
  }
  return text.replace(pattern, `$1"${version}"`);
}

const MOBILE_APP_JSON = join(ROOT, "apps", "mobile", "app.json");
const MOBILE_APP_CONFIG = join(ROOT, "apps", "mobile", "app.config.ts");

/** Mobile's version and build number come only from `app.config.ts`, so
 *  `app.json` may carry neither. */
function mobileProblems() {
  const problems = [];
  const appJson = JSON.parse(readFileSync(MOBILE_APP_JSON, "utf8"));
  if (appJson.expo?.version !== undefined) {
    problems.push(
      `${relative(ROOT, MOBILE_APP_JSON)} carries expo.version — it must come from ` +
        "app.config.ts (which reads the app's package.json) so there is one source",
    );
  }
  // A static number here would look authoritative and do nothing.
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

/** Each unversioned workspace must still exist and still carry no version. */
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

/** The core a request names: a bump kind, or one of the three successors. */
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

/** Problems with the manifests' `{ path, version }` list. */
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
