// The git calls the release path needs; only `createTag` writes, and nothing
// here pushes.
import { execFileSync, spawnSync } from "node:child_process";

const git = (root, args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export const listTags = (root) =>
  git(root, ["tag", "--list"]).split("\n").filter(Boolean);

export const currentBranch = (root) =>
  git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);

export const headSha = (root) => git(root, ["rev-parse", "HEAD"]);

export const isClean = (root) => git(root, ["status", "--porcelain"]) === "";

/** Whether this is a shallow clone, whose tag list would look like a repo
 *  that never released; for `monotonic`. */
export const isShallow = (root) =>
  git(root, ["rev-parse", "--is-shallow-repository"]) === "true";

/** The commit a tag names, by `rev-list`, as `rev-parse` gives an annotated
 *  tag's own sha. */
export function tagSha(root, tag) {
  const run = spawnSync("git", ["rev-list", "-n", "1", tag], {
    cwd: root,
    encoding: "utf8",
    // A missing tag is an answer; git's stderr about it would only be noise.
    stdio: ["ignore", "pipe", "ignore"],
  });
  return run.status === 0 ? run.stdout.trim() : null;
}

/** Cuts an annotated tag on HEAD, or on `commit`, as `final` marks the older
 *  commit whose build went public. */
export function createTag(root, tag, message, commit) {
  git(root, ["tag", "-a", tag, "-m", message, ...(commit ? [commit] : [])]);
}

/** Whether `remote` has `tag`. False when the remote cannot be reached. */
export function remoteHasTag(root, tag, remote = "origin") {
  const run = spawnSync(
    "git",
    ["ls-remote", "--tags", remote, `refs/tags/${tag}`],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return run.status === 0 && run.stdout.trim() !== "";
}
