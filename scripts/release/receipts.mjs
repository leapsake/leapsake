// What a release actually shipped, recorded against the commit it shipped from.
//
// ## Why this exists
//
// The build number is a clock reading (`apps/mobile/app.config.ts` → `buildNumber`). That is
// what makes it collision-free and impossible to forget, and it is also what makes it
// **opaque**: given a build in App Store Connect there is no way back to the source it came
// from. Apple will tell you the build number and nothing else — the `LeapsakeCommit` baked
// into the shipped `Info.plist` is readable from an `.ipa`, but not over the API.
//
// So the mapping has to be *recorded at the moment it is known*, which is the only moment
// both halves are in the same process: right after a target publishes.
//
// Two callers want it, from opposite directions:
//
// - **Going live.** Apple names the build attached to the released version; the release path
//   needs the commit, so it can tag the thing that actually reached the public rather than
//   whatever HEAD happens to be days later.
// - **Resuming a partial release** (`plans/v0-2.md` → *Making a release re-run idempotent*).
//   A re-run needs to know which targets already shipped and under which build number, or it
//   mints a fresh one and re-uploads what succeeded.
//
// ## Why git notes rather than a file
//
// A receipt is metadata *about* a commit, and it is only knowable **after** that commit has
// been tagged and built. Writing it to a tracked file would mean a second commit, which
// moves HEAD past the very tag the receipt describes — the exact problem the whole
// tag-names-a-build design exists to avoid. A note attaches to the commit without changing
// it, and can be written after the fact.
//
// The cost is that notes do not travel with a normal push: `refs/notes/releases` has to be
// pushed explicitly, and `index.mjs` prints that in the push hint. On a runner it is one
// extra ref, which is a far smaller permission than write access to `main`.
//
// ## The format
//
// One JSON object per line, appended. `git notes append` separates entries with a blank
// line — verified, not assumed — so blank lines are part of the normal shape and the parser
// skips them rather than treating them as damage.
//
// The commit is deliberately **not** a field: the note is attached to it, and that
// attachment is the claim. Storing it twice would create two things that can disagree.
import { spawnSync } from "node:child_process";

/** The notes ref these live under. Namespaced so `git notes` defaults stay untouched. */
export const NOTES_REF = "releases";

/**
 * One shipment, as a single JSON line.
 *
 * Field order is fixed so a note reads consistently to a human running `git notes show` —
 * the identity of the release first, then what it produced.
 */
export function formatReceipt({
  tag,
  version,
  stage,
  target,
  buildNumber,
  bundleId,
  via,
  at,
}) {
  if (!tag || !target) {
    throw new Error("a receipt needs at least a tag and a target");
  }
  return JSON.stringify({
    tag,
    version,
    stage,
    target,
    // Normalized to a string: iOS carries it as one and Android as a number, and a receipt
    // compared against Apple's `filter[version]` should not care which produced it.
    build: buildNumber === undefined ? undefined : String(buildNumber),
    bundleId,
    via,
    at: at ?? new Date().toISOString(),
  });
}

/**
 * Every receipt in one note's text.
 *
 * **Tolerant on purpose.** A note is hand-editable and lives outside the test suite's reach,
 * so a line someone mangled should cost that one line rather than the whole lookup — the
 * caller's failure mode is "I cannot find the commit", and it is better to reach that with
 * three good receipts than to throw on the fourth.
 */
export function parseReceipts(noteText) {
  if (!noteText) return [];
  const found = [];
  for (const line of noteText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") found.push(parsed);
    } catch {
      // Not JSON: someone wrote a note by hand. Skip it and keep the rest.
    }
  }
  return found;
}

/** A git call that is allowed to fail — a missing note is an answer, not an error. */
function git(root, args) {
  const run = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return run.status === 0 ? run.stdout : null;
}

/**
 * Append one receipt to the note on `commit`.
 *
 * `append` rather than `add`: one commit can ship more than once — a re-run after a failed
 * distribute, or two targets from the same tag — and `add` refuses when a note exists.
 *
 * Returns `true` when it was written. **A failure here must not fail the release**: by the
 * time this runs the artifact is already uploaded, and turning a successful upload into a
 * failed release over a bookkeeping error would be the worse outcome. The caller warns.
 */
export function recordShipment(root, commit, fields) {
  const line = formatReceipt(fields);
  const written = git(root, [
    "notes",
    `--ref=${NOTES_REF}`,
    "append",
    "-m",
    line,
    commit,
  ]);
  return written !== null;
}

/** The receipts on one commit, oldest first. Empty when it has none. */
export function shipmentsFor(root, commit) {
  const note = git(root, ["notes", `--ref=${NOTES_REF}`, "show", commit]);
  return parseReceipts(note);
}

/**
 * Every receipt in the repository, each tagged with the commit it hangs on.
 *
 * `git notes list` prints `<note-blob> <annotated-commit>` per line, and answers an absent
 * ref with silence rather than an error — so a repository that has never recorded one reads
 * as an empty list without a special case.
 */
export function allShipments(root) {
  const listed = git(root, ["notes", `--ref=${NOTES_REF}`, "list"]);
  if (!listed) return [];
  const shipments = [];
  for (const line of listed.trim().split("\n")) {
    const commit = line.trim().split(/\s+/)[1];
    if (!commit) continue;
    for (const receipt of shipmentsFor(root, commit)) {
      shipments.push({ ...receipt, commit });
    }
  }
  return shipments;
}

/**
 * The commit a given build number shipped from, or `null` when it cannot be known.
 *
 * ⚠️ **Never guesses.** Two receipts claiming one build number means the record is
 * ambiguous, and the honest answer to "which commit is live?" is then *I don't know* — a
 * caller about to tag a public release must refuse rather than pick. `null` covers both
 * "no receipt" and "more than one", because the caller's response to each is the same:
 * stop, and let a person say.
 */
export function commitOfBuild(root, { target, buildNumber }) {
  const wanted = String(buildNumber);
  const matches = allShipments(root).filter(
    (each) => each.build === wanted && (!target || each.target === target),
  );
  const [first] = matches;
  return matches.length === 1 ? first.commit : null;
}
