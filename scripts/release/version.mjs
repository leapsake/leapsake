// Version and tag algebra: pure, so `version.test.mjs` tests it directly.
//
// alpha, beta and rc are channels that each count up independently on a core; a person
// picks the channel and the counter comes from the existing tags.

/** The channels, plus `final`, which closes a core. */
export const STAGES = ["alpha", "beta", "rc", "final"];

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Parse `X.Y.Z` or `X.Y.Z-suffix` into its parts, or `null` when it is not a version.
 * The accepted shape matches `scripts/set-version.mjs`, deliberately: a version this
 * cannot read is a version that cannot be written to the manifests either.
 */
export function parseVersion(version) {
  const match = VERSION.exec(version);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease === undefined ? [] : prerelease.split("."),
  };
}

/** `0.1.0-alpha.2` → `0.1.0`. The numeric core, which is also what the stores see. */
export function coreOf(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`not a version: "${version}"`);
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

/** The channel a version is on. A version with no suffix is `final`. */
export function stageOf(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`not a version: "${version}"`);
  const [stage] = parsed.prerelease;
  if (parsed.prerelease.length === 0) return "final";
  return STAGES.includes(stage) ? stage : null;
}

/** Semver precedence (semver.org §11). */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left) throw new Error(`not a version: "${a}"`);
  if (!right) throw new Error(`not a version: "${b}"`);

  for (const part of ["major", "minor", "patch"]) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const x = left.prerelease[i];
    const y = right.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** `v0.1.0-rc.1` ↔ `0.1.0-rc.1`. Tags carry the `v`; manifests never do. */
export const formatTag = (version) => `v${version}`;

/** The version a tag names, or `null` for a tag that is not a release tag at all. */
export function parseTag(tag) {
  if (!tag.startsWith("v")) return null;
  const version = tag.slice(1);
  return parseVersion(version) ? version : null;
}

/** Every release tag in the list, as versions, highest precedence last. */
export function releaseVersions(tags) {
  return tags
    .map(parseTag)
    .filter((version) => version !== null)
    .sort(compareVersions);
}

/** The highest release version among the tags, or `null` when there are none. */
export function highestVersion(tags) {
  const versions = releaseVersions(tags);
  return versions.length > 0 ? versions[versions.length - 1] : null;
}

/** The ways to name the next core without typing it. */
export const BUMP_KINDS = ["patch", "minor", "major"];

/** The three cores semver allows after `core`. */
export function successorCores(core) {
  const parsed = parseVersion(core);
  if (!parsed) throw new Error(`not a version: "${core}"`);
  return {
    patch: `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`,
    minor: `${parsed.major}.${parsed.minor + 1}.0`,
    major: `${parsed.major + 1}.0.0`,
  };
}

/**
 * The next version on a channel: the highest counter already tagged for this core and
 * stage, plus one, or `.1` when there is none. `final` is the bare core.
 */
export function nextVersion({ core, stage, tags = [] }) {
  if (!STAGES.includes(stage)) {
    throw new Error(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);
  }
  if (stage === "final") return core;

  let highest = 0;
  for (const version of releaseVersions(tags)) {
    const parsed = parseVersion(version);
    if (coreOf(version) !== core) continue;
    const [tagStage, counter] = parsed.prerelease;
    if (tagStage !== stage || !/^\d+$/.test(counter ?? "")) continue;
    highest = Math.max(highest, Number(counter));
  }
  return `${core}-${stage}.${highest + 1}`;
}
