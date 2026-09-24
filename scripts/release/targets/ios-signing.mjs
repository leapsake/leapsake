// A runner has no login keychain holding the distribution identity, and no installed
// profile. When the .p12 and its password are given as files, stage both for one build.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PROFILE_DIRS = [
  // Xcode 16 reads profiles here; older tools read the MobileDevice directory.
  ["Library", "Developer", "Xcode", "UserData", "Provisioning Profiles"],
  ["Library", "MobileDevice", "Provisioning Profiles"],
];

const SIGNING_FILES = [
  "IOS_DIST_CERT_P12_PATH",
  "IOS_DIST_CERT_PASSWORD_PATH",
  "IOS_PROVISIONING_PROFILE_PATH",
];

/** Why the runner signing files are unusable, or undefined when all or none are set. */
export function signingFilesProblem(env = process.env) {
  const set = SIGNING_FILES.filter((name) => env[name]?.trim());
  if (set.length === 0) return undefined;
  if (set.length < SIGNING_FILES.length) {
    return `${SIGNING_FILES.join(", ")} go together — set all three, or none to sign from the login keychain`;
  }
  const missing = set.find((name) => !existsSync(env[name].trim()));
  return missing ? `${missing} names no file` : undefined;
}

const security = (args) => execFileSync("security", args, { encoding: "utf8" });

/**
 * Import the distribution identity into a throwaway keychain on the search list and
 * install the profile. Returns the teardown; a no-op when the .p12 is not configured.
 */
export function stageSigningIdentity({
  env = process.env,
  run = security,
  home = homedir(),
  tempDir = tmpdir(),
} = {}) {
  const problem = signingFilesProblem(env);
  if (problem) throw new Error(problem);
  const [p12, passwordPath, profilePath] = SIGNING_FILES.map((name) =>
    env[name]?.trim(),
  );
  if (!p12) return () => {};

  const keychain = join(tempDir, `leapsake-signing-${process.pid}.keychain-db`);
  const keychainPassword = randomBytes(24).toString("hex");
  const searchList = parseSearchList(run(["list-keychains", "-d", "user"]));
  const installed = [];

  const teardown = () => {
    run(["list-keychains", "-d", "user", "-s", ...searchList]);
    try {
      run(["delete-keychain", keychain]);
    } catch {
      // Already gone: a failed setup can leave nothing to delete.
    }
    for (const path of installed) rmSync(path, { force: true });
  };

  try {
    run(["create-keychain", "-p", keychainPassword, keychain]);
    run(["set-keychain-settings", "-lut", "21600", keychain]);
    run(["unlock-keychain", "-p", keychainPassword, keychain]);
    run([
      "import",
      p12,
      "-k",
      keychain,
      "-P",
      readFileSync(passwordPath, "utf8").trim(),
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    run([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keychainPassword,
      keychain,
    ]);
    run(["list-keychains", "-d", "user", "-s", keychain, ...searchList]);

    const uuid = profileUuid(run(["cms", "-D", "-i", profilePath]));
    for (const parts of PROFILE_DIRS) {
      const dir = join(home, ...parts);
      mkdirSync(dir, { recursive: true });
      const target = join(dir, `${uuid}.mobileprovision`);
      copyFileSync(profilePath, target);
      installed.push(target);
    }
  } catch (error) {
    teardown();
    throw error;
  }
  return teardown;
}

/** `security list-keychains` prints one quoted path per line. */
export function parseSearchList(output) {
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/** The UUID a decoded profile plist declares; Xcode finds an installed profile by it. */
export function profileUuid(plist) {
  const match = plist.match(
    /<key>UUID<\/key>\s*<string>([0-9A-Fa-f-]+)<\/string>/,
  );
  if (!match) throw new Error("the provisioning profile declares no UUID");
  return match[1];
}
