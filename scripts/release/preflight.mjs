// The repo-wide preconditions, in the same `{ name, check }` shape the targets use.
//
// These are the ones that hold regardless of platform. Each says what it protects in its
// failure message rather than deferring to a document, because the moment a release is
// refused is the moment the reason gets read.
import { spawnSync } from "node:child_process";

import { compareVersions, formatTag, highestVersion } from "./version.mjs";
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
    return `${version} does not come after ${highest} (${formatTag(highest)} is the highest tag) — store versions only ever go forward`;
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
  monotonic,
];

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
