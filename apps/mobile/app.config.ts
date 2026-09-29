import { execFileSync } from "node:child_process";

import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

// Derives over `app.json` what must not be duplicated: the store version, build
// numbers and commit (the app's README → What the build stamps into itself).

/** The repo version minus any pre-release suffix, which both stores reject. */
function storeVersion(version: string): string {
  const [numeric] = version.split("-");
  if (!/^\d+\.\d+(\.\d+)?$/.test(numeric)) {
    throw new Error(
      `version "${version}" has no store-legal numeric core (need X.Y or X.Y.Z, got "${numeric}")`,
    );
  }
  return numeric;
}

/** Minutes since this instant are the build number; see {@link buildNumber}. */
const BUILD_EPOCH_MS = Date.UTC(2026, 0, 1);

/** Minutes since {@link BUILD_EPOCH_MS}, shared by both stores; pinned by
 *  `LEAPSAKE_BUILD_NUMBER`. Minutes fit Android's 32-bit `versionCode`. */
function buildNumber(): number {
  // Blank means unset: `.env.example` ships the variable empty.
  const pinned = process.env.LEAPSAKE_BUILD_NUMBER?.trim();
  if (pinned) {
    if (!/^\d+$/.test(pinned)) {
      throw new Error(
        `LEAPSAKE_BUILD_NUMBER must be a positive integer, got "${pinned}"`,
      );
    }
    return Number(pinned);
  }
  return Math.floor((Date.now() - BUILD_EPOCH_MS) / 60_000);
}

/** One git read, quiet on failure; {@link commitSha} reads the absence. */
const gitRead = (args: string[]) =>
  execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();

/** The commit this artifact was built from, stamped into it; `"unknown"`
 *  without git. `LEAPSAKE_COMMIT`, then `GITHUB_SHA`, override git. */
function commitSha(): string {
  const pinned = process.env.LEAPSAKE_COMMIT ?? process.env.GITHUB_SHA;
  if (pinned?.trim()) return pinned.trim().slice(0, 12);

  // Never fatal: a build from a source tarball has no git, and says "unknown".
  try {
    const sha = gitRead(["rev-parse", "--short=12", "HEAD"]);
    return gitRead(["status", "--porcelain"]) === "" ? sha : `${sha}-dirty`;
  } catch {
    return "unknown";
  }
}

/** The full release version the release script passes in, or `dev`. */
function releaseVersion(): string {
  return process.env.LEAPSAKE_RELEASE?.trim() || "dev";
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const build = buildNumber();
  const commit = commitSha();
  return {
    ...config,
    name: config.name ?? "Leapsake",
    slug: config.slug ?? "leapsake",
    version: storeVersion(pkg.version),
    ios: {
      ...config.ios,
      buildNumber: String(build),
      // Spread first: `app.json` owns the block, and this adds one key.
      infoPlist: { ...config.ios?.infoPlist, LeapsakeCommit: commit },
    },
    android: { ...config.android, versionCode: build },
    extra: { ...config.extra, commit, release: releaseVersion() },
  };
};
