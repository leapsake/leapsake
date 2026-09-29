// What a release shipped, as git notes on the commit it shipped from. See
// `scripts/release/README.md` → _Receipts_.
import { spawnSync } from "node:child_process";

/** The notes ref, namespaced so `git notes` defaults stay untouched. */
export const NOTES_REF = "releases";

/** One shipment as a JSON line, its fields in a fixed, readable order. */
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
    // A string, whichever platform produced it.
    build: buildNumber === undefined ? undefined : String(buildNumber),
    bundleId,
    via,
    at: at ?? new Date().toISOString(),
  });
}

/** Every receipt in a note, skipping any line that does not parse. */
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
      // A hand-written line: skip it and keep the rest.
    }
  }
  return found;
}

/** A git call allowed to fail: a missing note is an answer. */
function git(root, args) {
  const run = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return run.status === 0 ? run.stdout : null;
}

/** Appends a receipt, as a commit can ship twice; returns whether it wrote,
 *  and never fails the release. */
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

/** Every receipt with its commit; an absent ref lists nothing. */
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

/** The commit a build number shipped from, or `null` for none or ⚠️ more than
 *  one: never a guess. */
export function commitOfBuild(root, { target, buildNumber }) {
  const wanted = String(buildNumber);
  const matches = allShipments(root).filter(
    (each) => each.build === wanted && (!target || each.target === target),
  );
  const [first] = matches;
  return matches.length === 1 ? first.commit : null;
}
