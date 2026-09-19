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
  releaseVersions,
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
 * A tag's core never goes below the highest core tagged, and a core with a final tag is
 * closed. Refuses when the tag list cannot be trusted, since an empty one would pass.
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

/** The tag's core is the manifests' core, which is what the store builds read. */
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

/** Marking a release that already went public: the tag lands on an older commit, not HEAD. */
export const MARKER_CHECKS = [tagAvailable, monotonic];

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
