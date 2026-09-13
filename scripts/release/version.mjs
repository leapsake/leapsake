// Version and tag algebra — the only place a release number is decided.
//
// The rule this file exists to enforce: **a human chooses the stage, never the number.**
// `alpha` → `beta` → `rc` → final is a ladder of tags, and the counter on each rung is
// derived from the tags that already exist rather than typed. Starting a new release train
// is the one decision left to a person, and it is made once per train with `--base=`.
//
// ⚠️ **Prefer `--base=patch|minor|major` to a typed number.** A base that goes *backwards*
// is caught by the monotonic guard; a base that goes too far **forwards** is not, and it is
// the one unrecoverable mistake in the whole path — the stores see the numeric core, so a
// mistyped `--base=1.1.0` spends `1.1.0` and burns every version beneath it, permanently.
// Naming the kind of bump instead removes the number from human hands, which is the same
// principle the rest of this file already applies to the counters.
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

/** The ways to name a new train without typing its number. */
export const BUMP_KINDS = ["patch", "minor", "major"];

/**
 * The only three cores a release train may legitimately start on, given the one before it.
 *
 * Semver leaves exactly this much choice, which is what makes it a useful guard: everything
 * outside these three is a typo rather than a decision. `0.1.0` may be followed by `0.1.1`,
 * `0.2.0` or `1.0.0` — never by `0.11.0`, and never by `1.1.0`.
 */
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
 * The core this release sits on: the manifests' own, a computed successor of it, or an
 * explicit one.
 *
 * An explicit base must be a bare `X.Y.Z`. A suffix here would be a second, competing
 * source of the rung — `--base=0.2.0-rc.1` reads as if it set the stage, and it does not.
 */
function resolveCore(current, base) {
  const core = coreOf(current);
  if (base === undefined) return core;
  if (BUMP_KINDS.includes(base)) return successorCores(core)[base];
  if (!/^\d+\.\d+\.\d+$/.test(base)) {
    throw new Error(
      `--base must be ${BUMP_KINDS.join("|")} or a bare X.Y.Z, got "${base}"`,
    );
  }
  return base;
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
 * @param base a {@link BUMP_KINDS} kind, or an explicit bare core — how a new train starts
 * @param tags every tag in the repo
 */
export function nextVersion({ current, stage, base, tags = [] }) {
  if (!STAGES.includes(stage)) {
    throw new Error(`unknown stage "${stage}" (expected ${STAGES.join(", ")})`);
  }
  const core = resolveCore(current, base);
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
