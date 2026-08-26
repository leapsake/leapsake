// Version and tag algebra — the only place a release number is decided.
//
// The rule this file exists to enforce: **a human chooses the stage, never the number.**
// `alpha` → `beta` → `rc` → final is a ladder of tags, and the counter on each rung is
// derived from the tags that already exist rather than typed. The one number a person
// picks is the base `X.Y.Z` when a new release train starts, which is a decision made once
// per train and passed explicitly (`--base=`).
//
// Everything here is pure — no git, no filesystem — so it can be tested directly
// (`version.test.mjs`). The caller supplies the tag list.
//
// Why the comparison below is real semver precedence rather than a string sort: the
// monotonic guard in `preflight.mjs` is the last thing standing between a typo and a store
// version that can never be taken back. Both stores refuse a version lower than one
// already uploaded, and a wrong number is not fixable in the next release — it is fixable
// only by burning the version.

/** The ladder. Order is significant: it is the order of increasing maturity. */
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

/** Which rung of the ladder a version sits on. A version with no suffix is `final`. */
export function stageOf(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`not a version: "${version}"`);
  const [stage] = parsed.prerelease;
  if (parsed.prerelease.length === 0) return "final";
  return STAGES.includes(stage) ? stage : null;
}

/**
 * Semver precedence (semver.org §11): numeric core first, then a version *with* a
 * pre-release ranks below the same core without one, then identifier by identifier —
 * numeric identifiers compare numerically and rank below alphanumeric ones, and a shorter
 * identifier set ranks below a longer one that shares its prefix.
 *
 * `alpha < beta < rc` falls out of the alphanumeric comparison for free; the ladder needs
 * no special casing.
 */
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

/**
 * The next version on a rung: the highest counter already tagged for this core and stage,
 * plus one — or `.1` when this is the first build on the rung.
 *
 * Moving *up* the ladder needs no argument beyond the stage. From `0.1.0-alpha.3`,
 * `nextVersion({ current, stage: "beta" })` is `0.1.0-beta.1`, because the core carries
 * over and the beta counter starts fresh. Moving *down* is not rejected here — it produces
 * a version that loses to an existing tag, which the monotonic guard then refuses with a
 * message that explains it. One rule, enforced in one place.
 *
 * @param current the version the manifests currently hold
 * @param stage one of {@link STAGES}
 * @param base overrides the core — the one number a human picks, once per release train
 * @param tags every tag in the repo
 */
export function nextVersion({ current, stage, base, tags = [] }) {
  if (!STAGES.includes(stage)) {
    throw new Error(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);
  }
  const core = base ?? coreOf(current);
  if (!parseVersion(core)) throw new Error(`not a version: "${core}"`);
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
