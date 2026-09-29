// What the mobile targets share: the app, build steps, and Expo's config.
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

/** The version and build number Expo resolves, read back so `app.config.ts`
 *  stays their only derivation. */
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

/** Pins the build number for the rest of the release. ⚠️ Unpinned, it is a
 *  clock reading, and two targets would differ. */
export function pinBuildNumber(config) {
  const build = config.android?.versionCode ?? config.ios?.buildNumber;
  if (build === undefined) {
    throw new Error(
      "expo config resolved no build number — check apps/mobile/app.config.ts",
    );
  }
  if (!process.env.LEAPSAKE_BUILD_NUMBER?.trim()) {
    process.env.LEAPSAKE_BUILD_NUMBER = String(build);
  }
  return Number(process.env.LEAPSAKE_BUILD_NUMBER);
}

/** `resolvedConfig`, its build number pinned for every later target. */
export function pinnedConfig(mobile) {
  const config = resolvedConfig(mobile);
  pinBuildNumber(config);
  return config;
}

/** The real app icon, checked on the rungs that reach strangers. */
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
