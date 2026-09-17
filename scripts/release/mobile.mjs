// What the two mobile targets share: where the app lives, how to run a build step, and
// how to ask Expo what it resolved.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const MOBILE = (root) => join(root, "apps", "mobile");

export const readAppJson = (root) =>
  JSON.parse(readFileSync(join(MOBILE(root), "app.json"), "utf8"));

/** Run a build step, inheriting stdio, and throw with a label if it fails. */
export function must(label, command, args, options = {}) {
  const run = spawnSync(command, args, { stdio: "inherit", ...options });
  if (run.error) throw new Error(`${label}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${label} failed (exit ${run.status})`);
}

/**
 * The version and build number Expo *itself* would use, read back rather than recomputed.
 *
 * `apps/mobile/app.config.ts` owns both derivations — the store version is the repo
 * version with its pre-release suffix stripped, and the build number is minutes since
 * 2026-01-01 UTC. Asking Expo for the resolved config keeps that the only implementation,
 * and is what makes `ios.buildNumber` and `android.versionCode` the same clock reading.
 * The number is then pinned through the prebuild via `LEAPSAKE_BUILD_NUMBER`, because a
 * second unpinned derivation a minute later would produce a different one.
 */
export function resolvedConfig(mobile) {
  const out = execFileSync("pnpm", ["exec", "expo", "config", "--json"], {
    cwd: mobile,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  // Expo may print notices before the JSON; take from the first brace.
  const start = out.indexOf("{");
  if (start === -1) throw new Error("expo config produced no JSON");
  return JSON.parse(out.slice(start));
}

/**
 * The placeholder icon is the first thing that stops being acceptable when the audience
 * grows past the owner — the rungs that reach strangers are where it is checked.
 */
export const appIcon = {
  name: "app icon",
  check: ({ root }) => {
    const icon = readAppJson(root).expo?.icon;
    if (!icon) {
      return "apps/mobile/app.json sets no expo.icon — the build would ship Expo's default placeholder";
    }
    return existsSync(join(MOBILE(root), icon))
      ? undefined
      : `apps/mobile/app.json points expo.icon at "${icon}", which does not exist`;
  },
};
