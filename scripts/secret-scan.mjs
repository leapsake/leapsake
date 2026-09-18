// Scan this repo's git history for committed secrets.
//
// Why history and not the working tree: a secret deleted in the next commit is still
// there forever for anyone who clones, and this repo is about to go public
// (plans/shipping.md → Part 1, step 2). Filename-level care — the `.gitignore` block over
// `*.p12`, `AuthKey_*.p8`, `*.jks` — only stops the files someone thought to name. This
// reads the bytes of every blob that was ever committed.
//
// TWO MODES, because "full history" turns out to be ambiguous in a repo that has been
// rewritten (there is a `refs/original/` here) and pushed:
//
//   default        `gitleaks git`, every ref via `--log-opts=--all`. ~4s. This is the
//                  gate: cheap enough to run on every `pnpm test:all`.
//   --all-objects  every blob in the object database, reachable or not, by dumping each
//                  one and scanning the dump. ~2.5x the bytes and a 150MB scratch dir, so
//                  it is not the routine gate — but it is the honest answer before going
//                  public. ⚠️ `git clone` only ever transfers *reachable* objects, but a
//                  host that has already received a push keeps the unreachable ones
//                  addressable by SHA — so a force-pushed secret stays fetchable from the
//                  remote long after no branch points at it. Run this before flipping the
//                  repo public, and after any history rewrite.
//
// Findings are judged, never bulk-silenced. A permanent, deliberately-public key goes in
// `.gitleaks.toml` by path; a specific finding that has been read and accepted goes in
// `.gitleaksignore` by fingerprint, with a note. Both files explain the rule at the top.
// The two modes fingerprint differently on purpose — commit:path:rule:line for the gate,
// blob-sha:rule:line for the deep scan, which is content-addressed and so cannot drift.
//
// ⚠️ A hit here is not fixed by rewriting history. A rewrite does not reach clones, forks
// or CI caches, so a secret that was ever pushed must be **rotated** — the same rule the
// `.gitignore` credentials block states. Rewrite afterwards if you like; rotate first.
//
// Exit codes follow the harness contract (scripts/test-all.mjs): 0 clean, 1 findings,
// 3 the scanner could not be obtained (offline) → reported ⏳ BLOCKED, and a hard failure
// under `--strict`, so no release can pass with the scan unrun.
//
// Usage: node scripts/secret-scan.mjs [--all-objects] [--json]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureGitleaks,
  GitleaksUnavailable,
  gitleaksVersion,
  repoRoot,
} from "./lib/ensure-gitleaks.mjs";

const asJson = process.argv.includes("--json");
const allObjects = process.argv.includes("--all-objects");

const git = (args) =>
  execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });

// The same, returning raw bytes. Blob contents must never go through a string: decoding
// a binary blob as UTF-8 replaces every invalid byte, which both inflates the dump and
// silently rewrites the bytes the scanner is supposed to be reading.
const gitBytes = (args) =>
  execFileSync("git", args, { cwd: repoRoot, maxBuffer: 1 << 28 });

let bin;
try {
  bin = await ensureGitleaks();
} catch (err) {
  if (err instanceof GitleaksUnavailable) {
    console.error(`⏳ secret scan blocked — ${err.message}`);
    console.error(
      "   The pinned gitleaks binary is not cached and could not be downloaded.\n" +
        "   Re-run with a network connection; nothing needs installing by hand.",
    );
    process.exit(3);
  }
  throw err;
}

const work = mkdtempSync(join(tmpdir(), "leapsake-secret-scan-"));
const report = join(work, "report.json");

/** Dump every blob in the object database; returns the directory holding them. */
const dumpAllBlobs = () => {
  const dir = join(work, "blobs");
  execFileSync("mkdir", ["-p", dir]);
  const shas = git([
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname) %(objecttype)",
  ])
    .split("\n")
    .filter((l) => l.endsWith(" blob"))
    .map((l) => l.slice(0, 40));

  // ⚠️ The dump files must have NO extension. gitleaks' default config allowlists a long
  // list of binary/lockfile suffixes by path regex, so naming these `<sha>.bin` makes it
  // skip every one and cheerfully report "scanned ~0 bytes … no leaks found" — a green
  // that means nothing. Named by bare SHA, the fingerprint is content-addressed too.
  for (const sha of shas) {
    writeFileSync(join(dir, sha), gitBytes(["cat-file", "-p", sha]));
  }
  return { dir, count: shas.length };
};

try {
  let args;
  let cwd = repoRoot;
  let scope;

  if (allObjects) {
    const { dir, count } = dumpAllBlobs();
    // A dump that produced nothing would scan clean. Fail loudly instead.
    if (count === 0) throw new Error("no blobs found in the object database");
    scope = `${count} blobs (every object, reachable or not)`;
    cwd = dir;
    args = ["dir", "."];
  } else {
    const commits = git(["rev-list", "--all", "--count"]).trim();
    scope = `${commits} commits (every ref)`;
    args = ["git", repoRoot, "--log-opts=--all"];
  }

  const run = spawnSync(
    bin,
    [
      ...args,
      "--config",
      join(repoRoot, ".gitleaks.toml"),
      "--gitleaks-ignore-path",
      join(repoRoot, ".gitleaksignore"),
      // Secrets must never reach stdout or a CI log: the report carries locations, the
      // repo carries the value, and whoever is fixing it can look it up themselves.
      "--redact",
      "--no-banner",
      "--report-format",
      "json",
      "--report-path",
      report,
      // Findings are reported by *us*, from the JSON, so gitleaks' own exit code is
      // flattened to 0 and a non-zero one means the scanner itself failed.
      "--exit-code",
      "0",
    ],
    { cwd, stdio: ["ignore", "inherit", "inherit"] },
  );

  if (run.error) throw run.error;
  if (run.status !== 0) {
    console.error(`\n❌ gitleaks ${gitleaksVersion} exited ${run.status}`);
    process.exit(1);
  }

  const findings = JSON.parse(readFileSync(report, "utf8") || "[]");
  if (asJson) console.log(JSON.stringify(findings, null, 2));

  if (findings.length === 0) {
    console.log(`\n✅ no secrets — ${scope}, gitleaks ${gitleaksVersion}.`);
    process.exit(0);
  }

  console.error(`\n❌ ${findings.length} finding(s) — ${scope}:\n`);
  for (const f of findings) {
    if (allObjects) {
      // In this mode `File` is the blob's SHA, which says nothing on its own — resolve
      // it back to a path someone can recognise.
      const path =
        git(["rev-list", "--all", "--objects"])
          .split("\n")
          .find((l) => l.startsWith(f.File))
          ?.slice(41) ?? "(unreachable — no ref points at it)";
      console.error(`  ${f.RuleID}  ${path}:${f.StartLine}`);
      console.error(`    blob ${f.File.slice(0, 12)}`);
    } else {
      console.error(`  ${f.RuleID}  ${f.File}:${f.StartLine}`);
      console.error(
        `    ${f.Commit.slice(0, 8)} ${(f.Date ?? "").slice(0, 10)} ${f.Author ? `<${f.Author}>` : ""}`.trimEnd(),
      );
    }
    console.error(`    fingerprint: ${f.Fingerprint}`);
  }
  console.error(
    "\nRead each one against the blob (`git cat-file -p <sha>`) before deciding.\n" +
      "  · A live credential → ROTATE it. A history rewrite does not reach clones or forks.\n" +
      "  · Judged dead, or a false positive → add its fingerprint to .gitleaksignore,\n" +
      "    with a note saying what it is and why. Never a bare line.\n" +
      "  · Committed on purpose and public forever → .gitleaks.toml, by path.",
  );
  process.exit(1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
