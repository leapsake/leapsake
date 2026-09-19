// The git reads the release path needs. Reads only — the one place that *writes* is the
// mutation step in `index.mjs`, and nothing here pushes.
import { execFileSync, spawnSync } from "node:child_process";

const git = (root, args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export const listTags = (root) =>
  git(root, ["tag", "--list"]).split("\n").filter(Boolean);

export const currentBranch = (root) =>
  git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

export const headSha = (root) => git(root, ["rev-parse", "HEAD"]);

export const isClean = (root) => git(root, ["status", "--porcelain"]) === "";

/**
 * Whether this is a shallow clone — a checkout whose history, and therefore whose tag list,
 * is deliberately incomplete.
 *
 * It exists for `monotonic` in `preflight.mjs`. Every other check reads the working tree,
 * which a shallow clone represents perfectly well; that one reads *history*, and a partial
 * answer there is worse than no answer, because an incomplete tag list is indistinguishable
 * from a repository that has never released.
 */
export const isShallow = (root) =>
  git(root, ["rev-parse", "--is-shallow-repository"]) === "true";

/**
 * The commit a tag names. `rev-list -n 1` resolves annotated and lightweight tags alike,
 * where `rev-parse <tag>` would return the tag object's own sha for an annotated tag and
 * quietly fail a comparison against HEAD.
 */
export function tagSha(root, tag) {
  const run = spawnSync("git", ["rev-list", "-n", "1", tag], {
    cwd: root,
    encoding: "utf8",
    // A missing tag is an expected answer here, not an error to narrate: git writes
    // "ambiguous argument" to stderr, which would otherwise surface as noise above a
    // check that is about to explain the situation properly.
    stdio: ["ignore", "pipe", "ignore"],
  });
  return run.status === 0 ? run.stdout.trim() : null;
}

/**
 * Cut an annotated tag, on `commit` when one is named and on HEAD otherwise.
 *
 * The commit argument is what the `final` rung needs: a marker tag names the commit whose
 * build actually reached the public, and by the time Apple has said so HEAD has usually
 * moved on. Every other rung tags what it just built, which is HEAD.
 */
export function createTag(root, tag, message, commit) {
  git(root, ["tag", "-a", tag, "-m", message, ...(commit ? [commit] : [])]);
}
