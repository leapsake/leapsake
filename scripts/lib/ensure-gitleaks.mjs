// Fetch the pinned `gitleaks` binary into the repo, so the secret scan is a repo tool
// rather than something every machine has to install.
//
// Same shape as `scripts/ensure-sqlite-abi.mjs`: make sure a native binary this repo
// needs is present for the runtime that is about to use it, then get out of the way.
// The binary lands in `node_modules/.cache/` — already gitignored, wiped by a clean
// install, and never on `PATH`, so nothing outside this checkout is touched.
//
// Why not an npm wrapper (`@b12k/gitleaks` and friends): this repo goes public and its
// whole subject is custody of other people's data, so a third-party postinstall that
// downloads a binary is a worse trust posture than pinning the *official* release and
// checking the hash ourselves. It is about thirty lines of difference.
//
// Bumping the version: change VERSION, then replace CHECKSUMS wholesale from
// https://github.com/gitleaks/gitleaks/releases/download/v<VERSION>/gitleaks_<VERSION>_checksums.txt
// Never edit one line of it by hand — the point of the table is that it came from the
// release as a unit.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const VERSION = "8.30.1";

// From gitleaks_8.30.1_checksums.txt. Only the platforms this repo's tiers run on are
// kept: macOS (dev + the future hosted runner) and Linux (CI). Windows is out of scope
// repo-wide (CONTRIBUTING.md → The E2E release gate).
const CHECKSUMS = {
  darwin_arm64:
    "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
  darwin_x64:
    "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
  linux_arm64:
    "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
  linux_x64: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
};

export const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Thrown when the binary is absent *and* unobtainable — offline, typically. */
export class GitleaksUnavailable extends Error {}

const platformKey = () => {
  const os =
    process.platform === "darwin"
      ? "darwin"
      : process.platform === "linux"
        ? "linux"
        : null;
  const arch =
    process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!os || !arch) return null;
  return `${os}_${arch}`;
};

/**
 * Absolute path to a verified gitleaks binary, downloading it on first use.
 * Throws GitleaksUnavailable if it cannot be fetched; every other failure — a hash
 * mismatch above all — is a hard error and must stay one.
 */
export async function ensureGitleaks() {
  const key = platformKey();
  if (!key) {
    throw new GitleaksUnavailable(
      `no pinned gitleaks build for ${process.platform}/${process.arch}`,
    );
  }

  const dir = join(repoRoot, "node_modules", ".cache", "gitleaks", VERSION);
  const bin = join(dir, "gitleaks");
  if (existsSync(bin)) return bin;

  const asset = `gitleaks_${VERSION}_${key}.tar.gz`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${asset}`;

  let bytes;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      throw new GitleaksUnavailable(`${url} → HTTP ${res.status}`);
    }
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    if (err instanceof GitleaksUnavailable) throw err;
    throw new GitleaksUnavailable(`could not download ${url}: ${err.message}`);
  }

  // Verify *before* anything is extracted or executed. A mismatch is not a network
  // problem and must never degrade to "blocked, carry on" — it is either a corrupted
  // download or a substituted artifact, and both stop the run.
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== CHECKSUMS[key]) {
    throw new Error(
      `gitleaks ${VERSION} ${key} checksum mismatch\n` +
        `  expected ${CHECKSUMS[key]}\n  got      ${got}\n` +
        `Refusing to run it. Re-run to retry the download; if it persists, compare the\n` +
        `published checksums file before touching the table in this script.`,
    );
  }

  mkdirSync(dir, { recursive: true });
  const tarball = join(dir, asset);
  writeFileSync(tarball, bytes);
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", dir, "gitleaks"], {
      stdio: "inherit",
    });
  } finally {
    rmSync(tarball, { force: true });
  }
  if (!existsSync(bin)) {
    throw new Error(
      `extracted ${asset} but found no gitleaks binary in ${dir}`,
    );
  }
  return bin;
}

export const gitleaksVersion = VERSION;
