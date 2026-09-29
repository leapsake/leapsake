// Fetches the pinned, checksummed `gitleaks` into `node_modules/.cache/`. See
// `CONTRIBUTING.md` → _Testing_ for why, and how to bump it.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const VERSION = "8.30.1";

// From the release's checksums file, macOS and Linux only; replace wholesale.
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

/** Thrown when the binary is absent and unobtainable, as when offline. */
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

/** A verified gitleaks binary's path, downloaded on first use; only an
 *  unfetchable one is `GitleaksUnavailable`. */
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

  // Verified before extracting: a mismatch is never "blocked", always fatal.
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
