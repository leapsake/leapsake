// Scans git history for secrets: `[--all-objects] [--json]`. See
// `CONTRIBUTING.md` → _Testing_ for the modes, and ⚠️ rotate before rewriting.
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

// Raw bytes: decoding a blob as UTF-8 would rewrite what the scanner reads.
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

/** Dumps every blob in the object database into a returned directory. */
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

  // ⚠️ No extension, or gitleaks skips the files and scans nothing clean;
  // a bare SHA also makes the fingerprint content-addressed.
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
    // An empty dump would scan clean, so fail instead.
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
      // No secret may reach stdout or a CI log; the report gives locations.
      "--redact",
      "--no-banner",
      "--report-format",
      "json",
      "--report-path",
      report,
      // We report findings, so a non-zero exit means the scanner failed.
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
      // Here `File` is a blob SHA, resolved back to a recognisable path.
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
