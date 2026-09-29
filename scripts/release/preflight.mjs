// The platform-independent preconditions, each saying what it protects when
// it refuses.
import { spawnSync } from "node:child_process";

import {
  BUMP_KINDS,
  compareVersions,
  coreOf,
  formatTag,
  highestVersion,
  releaseVersions,
} from "./version.mjs";
import { headSha, tagSha } from "./git.mjs";

const RELEASE_BRANCH = /^release\/\d+\.\d+\.\d+$/;

/** A clean tree, so the artifact is exactly what the tag names. */
const cleanTree = {
  name: "clean tree",
  check: ({ clean }) =>
    clean
      ? undefined
      : "the working tree has uncommitted changes — a tag can only describe what is committed",
};

/** Releases come from `main`, or a `release/X.Y.Z` stabilizing branch. */
const releaseBranch = {
  name: "branch",
  check: ({ branch }) =>
    branch === "main" || RELEASE_BRANCH.test(branch)
      ? undefined
      : `releases are cut from main or release/X.Y.Z, not "${branch}"`,
};

/** Every manifest agrees, by the script that owns the rule. */
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

/** A new tag, since reusing one would redefine a shipped release. */
const tagAvailable = {
  name: "tag is free",
  check: ({ root, tag }) =>
    tagSha(root, tag) === null
      ? undefined
      : `${tag} already exists — a release tag is never moved or reused`,
};

/** No core below the highest tagged, nor on a closed one; refuses when the
 *  tag list can't be trusted. */
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

    const core = coreOf(version);
    const highestCore = coreOf(highest);
    if (compareVersions(core, highestCore) < 0) {
      return `${version} is on ${core}, but ${highestCore} has already been tagged (${formatTag(highest)}) — store versions only ever go forward`;
    }
    if (releaseVersions(tags).includes(core)) {
      return `${core} is closed: ${formatTag(core)} released it. Start the next core with node scripts/set-version.mjs ${BUMP_KINDS.join("|")}`;
    }
    return undefined;
  },
};

/** The tag exists and names the checked-out commit. */
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

/** The tag's core is the manifests', which the store builds read. */
export const tagMatchesManifests = {
  name: "tag matches manifests",
  check: ({ version, manifestVersion }) =>
    coreOf(version) === manifestVersion
      ? undefined
      : `the tag says ${version} but the manifests say ${manifestVersion} — the tag's core must be the one the tagged commit carries`,
};

/** Cutting a new tag locally. Ordered cheapest-and-most-likely-wrong first. */
export const LOCAL_CHECKS = [
  cleanTree,
  releaseBranch,
  manifestsAgree,
  tagAvailable,
  monotonic,
];

/** Marking a public release: the tag lands on an older commit, not HEAD. */
export const MARKER_CHECKS = [tagAvailable, monotonic];

/** Planning or shipping an existing tag, which a hand push kept from `cut`. */
export const FROM_TAG_CHECKS = [
  cleanTree,
  manifestsAgree,
  tagOnHead,
  tagMatchesManifests,
  monotonic,
];

/** Building one target of a tag; history is `plan`'s, so shallow is fine. */
export const BUILD_CHECKS = [
  cleanTree,
  manifestsAgree,
  tagOnHead,
  tagMatchesManifests,
];
