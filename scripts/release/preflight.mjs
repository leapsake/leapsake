// The repo-wide preconditions, in the same `{ name, check }` shape the targets use.
//
// These are the ones that hold regardless of platform. Each says what it protects in its
// failure message rather than deferring to a document, because the moment a release is
// refused is the moment the reason gets read.
import { spawnSync } from "node:child_process";

import {
  BUMP_KINDS,
  compareVersions,
  coreOf,
  formatTag,
  highestVersion,
  parseVersion,
  releaseVersions,
  successorCores,
} from "./version.mjs";
import { headSha, tagSha } from "./git.mjs";

const RELEASE_BRANCH = /^release\/\d+\.\d+\.\d+$/;

/**
 * A release describes a commit. An uncommitted change means the artifact would contain
 * something the tag does not name, and there would be no way to rebuild it later.
 */
const cleanTree = {
  name: "clean tree",
  check: ({ clean }) =>
    clean
      ? undefined
      : "the working tree has uncommitted changes — a tag can only describe what is committed",
};

/**
 * `main` is the only long-lived branch; `release/X.Y.Z` exists for the one case a tag
 * cannot cover — giving fixes somewhere to land while unrelated work keeps reaching main.
 */
const releaseBranch = {
  name: "branch",
  check: ({ branch }) =>
    branch === "main" || RELEASE_BRANCH.test(branch)
      ? undefined
      : `releases are cut from main or release/X.Y.Z, not "${branch}"`,
};

/**
 * Every manifest carries the same version. Delegated to the script that owns the rule so
 * there is one implementation of it, not two that can disagree.
 */
const manifestsAgree = {
  name: "version agreement",
  check: ({ root }) => {
    const run = spawnSync(
      process.execPath,
      ["scripts/set-version.mjs", "--check"],
      { cwd: root, encoding: "utf8" },
    );
    if (run.status === 0) return undefined;
    const detail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();
    return `manifests disagree on the version:\n    ${detail.split("\n").join("\n    ")}`;
  },
};

/** A tag names one commit forever; reusing one would silently redefine a shipped release. */
const tagAvailable = {
  name: "tag is free",
  check: ({ root, tag }) =>
    tagSha(root, tag) === null
      ? undefined
      : `${tag} already exists — a release tag is never moved or reused`,
};

/**
 * The guard that cannot be softened. Store version strings are permanent and monotonic:
 * once a build carrying `0.2.0` is uploaded, no `0.1.x` will ever be accepted again — and
 * because the pre-release suffix is stripped for the stores, a `0.2.0-alpha.1` upload
 * spends `0.2.0` as far as they are concerned. A number that goes backwards is not
 * fixable in the next release; it is fixable only by abandoning the version.
 *
 * ⚠️ **Its real failure mode is an absent comparison, not a wrong one.** This check reads
 * *history*, and every other one reads the working tree — so it is the only check a
 * checkout can defeat by being incomplete. An unreadable tag list looks exactly like a
 * repository that has never released, and the naive reading of that (nothing to compare
 * against, so allow it) fails **open** on precisely the guard whose mistake is permanent.
 *
 * Both shapes that produce it are what a runner does *by default* — a shallow clone, and a
 * checkout that fetched no tags — which is why this refuses instead of shrugging, and why
 * the one legitimate empty list has to be claimed out loud with `--first-release`.
 */
export const monotonic = {
  name: "version increases",
  check: ({ version, tags, shallow, firstRelease }) => {
    if (shallow) {
      return (
        "this is a shallow clone, so the tag list is incomplete and what has already " +
        "shipped cannot be known — fetch the full history and its tags before releasing " +
        "(actions/checkout wants fetch-depth: 0)"
      );
    }

    const highest = highestVersion(tags);
    if (highest === null) {
      return firstRelease
        ? undefined
        : "no release tags are visible, so there is nothing to compare against — on a " +
            "runner that almost always means tags were never fetched (actions/checkout " +
            "wants fetch-depth: 0), not that this is a new repository. If it really is " +
            "the first release here, pass --first-release to say so";
    }

    if (compareVersions(version, highest) > 0) return undefined;

    // The commonest way to land here is not a mistake about *this* number at all: it is
    // starting the next train without saying so, on a repository whose current core has
    // already shipped. Diagnosing the violation without naming the remedy would leave the
    // reader to infer `--base` at exactly the moment they are trying to ship.
    const core = coreOf(version);
    if (
      parseVersion(version).prerelease.length > 0 &&
      releaseVersions(tags).includes(core)
    ) {
      return `${core} has already shipped, so ${version} would go backwards — this is a new release train, and it needs a base: --base=${BUMP_KINDS.join("|")} (or an explicit X.Y.Z)`;
    }

    return `${version} does not come after ${highest} (${formatTag(highest)} is the highest tag) — store versions only ever go forward`;
  },
};

/**
 * Where a new release train is allowed to start.
 *
 * `monotonic` refuses a base that goes backwards. Nothing refused one that went too far
 * *forwards*, and that is the asymmetry worth closing: the stores see the numeric core, so
 * an upload of `1.1.0-alpha.1` spends `1.1.0` and every version below it is gone for good.
 * `--base=0.11.0` for `0.1.1`, or `1.1.0` for `0.1.1`, are one keystroke away and sail past
 * every other check in this file.
 *
 * Semver allows exactly three successors, so anything else is a typo rather than a
 * decision. A base equal to the current core is permitted only while that core is still
 * unreleased, where it is a no-op restating where the train already is.
 *
 * A {@link BUMP_KINDS} kind needs no check: it was computed rather than typed, which is the
 * whole reason to prefer it.
 */
export const baseIsSuccessor = {
  name: "base version",
  check: ({ base, manifestVersion, tags }) => {
    if (base === undefined || BUMP_KINDS.includes(base)) return undefined;

    const core = coreOf(manifestVersion);
    const released = releaseVersions(tags).includes(core);
    const legal = Object.values(successorCores(core));
    if (!released) legal.unshift(core);
    if (legal.includes(base)) return undefined;

    return `--base=${base} is not where this can go next. ${core} is ${
      released ? "already released" : "the train in progress"
    }, so the choices are ${legal.join(", ")} — or name the kind and let it be computed: --base=${BUMP_KINDS.join("|")}`;
  },
};

/** In `--from-tag` mode the tag is the input, so it has to describe *this* commit. */
const tagOnHead = {
  name: "tag names HEAD",
  check: ({ root, tag }) => {
    const sha = tagSha(root, tag);
    if (sha === null) return `${tag} does not exist in this repository`;
    return sha === headSha(root)
      ? undefined
      : `${tag} names ${sha.slice(0, 8)}, but HEAD is ${headSha(root).slice(0, 8)} — check out the tag before releasing it`;
  },
};

/**
 * The manifests are the source of the version and the tag names the commit that set them,
 * never the reverse: mobile derives its store version from `apps/mobile/package.json`, so
 * a checkout of a tag has to already be correct. A tag cannot supply what the build reads.
 */
const tagMatchesManifests = {
  name: "tag matches manifests",
  check: ({ version, manifestVersion }) =>
    version === manifestVersion
      ? undefined
      : `the tag says ${version} but the manifests say ${manifestVersion} — the tag must name the commit that set them`,
};

/** Cutting a new tag locally. Ordered cheapest-and-most-likely-wrong first. */
export const LOCAL_CHECKS = [
  cleanTree,
  releaseBranch,
  manifestsAgree,
  tagAvailable,
  // Before `monotonic`, so a bad base is named as such rather than reported downstream as
  // a complaint about the version derived from it.
  baseIsSuccessor,
  monotonic,
];

/**
 * Marking a release that already went public.
 *
 * Three of `LOCAL_CHECKS` are deliberately absent, and each omission is the same
 * observation: this rung builds nothing and writes no manifest — it tags a commit that was
 * built days ago and has since been approved by Apple. So the *current* state of the
 * checkout cannot affect what the tag means.
 *
 * - `cleanTree` — "a tag can only describe what is committed" is exactly right for a tag on
 *   HEAD, and vacuous for one on a commit from last week. Requiring it would mean stashing
 *   your work to answer an approval email.
 * - `releaseBranch` — the tag is not *cut from* a branch here; it names a commit directly.
 * - `manifestsAgree` — nothing is written to them, and the released commit's manifests
 *   legitimately read `X.Y.Z-rc.N` rather than the bare core being tagged.
 *
 * What stays is everything about the tag itself: it must be free, it must move the version
 * forward, and a `--base` must still be somewhere sane.
 */
export const MARKER_CHECKS = [tagAvailable, baseIsSuccessor, monotonic];

/**
 * Building an existing tag, as a runner does. The tag is the input here rather than the
 * output, so it is verified instead of created.
 *
 * `releaseBranch` is deliberately absent: a tag checkout is a detached HEAD, and *which*
 * branch a tag was cut from is a question about the commit's history, which
 * `LOCAL_CHECKS` already answered when the tag was made. `monotonic` is deliberately
 * present — a tag pushed by hand never passed through the local path, and that guard is
 * the one whose failure mode cannot be undone.
 */
export const FROM_TAG_CHECKS = [
  cleanTree,
  manifestsAgree,
  tagOnHead,
  tagMatchesManifests,
  monotonic,
];
