// The iOS target: App Store Connect, via a local archive. No Xcode session anywhere in
// the path — `expo prebuild` generates the project, `xcodebuild` archives and exports it,
// and `altool` uploads it with an API key rather than an Apple ID session.
//
// Two constraints shape everything here, both learned the expensive way and recorded in
// `plans/ios-release-pipeline.md`:
//
//  1. **`apps/mobile/ios/` is generated** by `expo prebuild` and gitignored. Nothing may
//     originate there — not the team, not the signing identity, not the build number.
//     Everything is passed at invocation, which is also what makes a runner viable.
//  2. **Manual signing, always.** Under `CODE_SIGN_STYLE=Automatic` Xcode resolves
//     development *and* distribution profiles before it will archive, so a machine with no
//     registered device fails for a reason unrelated to the build — and Apple's device
//     list resets only once per membership year. A build machine has no phone plugged in.
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { envSet } from "../checks.mjs";

const MOBILE = (root) => join(root, "apps", "mobile");

const readAppJson = (root) =>
  JSON.parse(readFileSync(join(MOBILE(root), "app.json"), "utf8"));

/**
 * Full Xcode, not just the Command Line Tools: `xcodebuild` ships inside Xcode.app, so a
 * CLT-only machine can notarize and sign but cannot archive.
 */
const xcodeSelected = {
  name: "Xcode",
  check: () => {
    if (process.platform !== "darwin") {
      return `an iOS archive needs macOS; this is ${process.platform}`;
    }
    let selected;
    try {
      selected = execFileSync("xcode-select", ["-p"], {
        encoding: "utf8",
      }).trim();
    } catch {
      return "xcode-select is not available — install Xcode and run `sudo xcodebuild -runFirstLaunch`";
    }
    // The CLT path is /Library/Developer/CommandLineTools; Xcode.app's is inside the app
    // bundle. Resolve first so a symlinked selection is judged on where it lands.
    const app = dirname(dirname(resolve(selected)));
    return app.endsWith(".app")
      ? undefined
      : `xcode-select points at "${selected}" (Command Line Tools) — xcodebuild needs full Xcode: sudo xcode-select -s /Applications/Xcode.app`;
  },
};

/**
 * The placeholder icon is the first thing that stops being acceptable when the audience
 * grows past the owner — external TestFlight is the rung where a stranger sees it.
 */
const appIcon = {
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

/**
 * Every upload sits at *Missing Compliance* — and is undistributable — until export
 * compliance is answered. Encoding the answer retires the per-upload prompt, but only once
 * the underlying question is settled: Leapsake implements standard algorithms *in the app*
 * (XChaCha20-Poly1305, Argon2id, HKDF-SHA256, AES-256 via SQLCipher), not merely OS crypto,
 * so `false` is not the honest answer and the EAR exemption question is still open.
 */
const exportCompliance = {
  name: "export compliance",
  check: ({ root }) => {
    const value =
      readAppJson(root).expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;
    return typeof value === "boolean"
      ? undefined
      : "apps/mobile/app.json sets no ios.infoPlist.ITSAppUsesNonExemptEncryption — every upload will stall at Missing Compliance (plans/ios-release-pipeline.md)";
  },
};

const signing = [
  envSet("APPLE_TEAM_ID", "the archive passes it as DEVELOPMENT_TEAM"),
  envSet(
    "IOS_PROVISIONING_PROFILE",
    "manual signing needs an explicit App Store distribution profile name",
  ),
];

/**
 * CocoaPods, which `expo prebuild` shells out to. Checked here rather than discovered
 * halfway through a prebuild that has already deleted the native project.
 */
const cocoapods = {
  name: "CocoaPods",
  check: () => {
    if (process.platform !== "darwin") return undefined;
    const run = spawnSync("pod", ["--version"], { stdio: "ignore" });
    return run.status === 0
      ? undefined
      : "`pod` is not on PATH — expo prebuild installs the iOS pods with it";
  },
};

// One App Store Connect API key covers the upload here and macOS notarization later, and
// unlike an Apple ID session it runs unattended.
const ascKey = [
  {
    // `altool` does not take a path: it searches a private-keys directory for a file named
    // `AuthKey_<key id>.p8`. So the name matters as much as the location, and getting it
    // wrong fails at the upload — after the archive, which is the expensive part. The
    // repo already assumes this shape: `.gitignore` excludes `AuthKey_*.p8` at any depth.
    name: "ASC_KEY_PATH",
    check: () => {
      const path = process.env.ASC_KEY_PATH?.trim();
      if (!path)
        return "ASC_KEY_PATH is not set — the upload authenticates with it";
      if (!existsSync(path))
        return `ASC_KEY_PATH points at "${path}", which does not exist`;
      const keyId = process.env.ASC_KEY_ID?.trim();
      const expected = keyId ? `AuthKey_${keyId}.p8` : null;
      if (expected && !path.endsWith(`/${expected}`)) {
        return `ASC_KEY_PATH must be named ${expected} for altool to find it, got "${path}"`;
      }
      return path.endsWith(".p8")
        ? undefined
        : `ASC_KEY_PATH should name a .p8 file, got "${path}"`;
    },
  },
  envSet("ASC_KEY_ID", "it identifies which App Store Connect key is in use"),
  envSet("ASC_ISSUER_ID", "App Store Connect keys are scoped to an issuer"),
];

/** Run a command, streaming its output, and throw with context when it fails. */
function must(label, command, args, options = {}) {
  const run = spawnSync(command, args, { stdio: "inherit", ...options });
  if (run.error) throw new Error(`${label}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${label} failed (exit ${run.status})`);
}

/**
 * The version and build number Expo *itself* would use, read back rather than recomputed.
 *
 * `apps/mobile/app.config.ts` owns both derivations — the store version is the repo
 * version with its pre-release suffix stripped, and the build number is minutes since
 * 2026-01-01 UTC. Asking Expo for the resolved config keeps that the only implementation.
 * The number is then pinned through the prebuild via `LEAPSAKE_BUILD_NUMBER`, because a
 * second unpinned derivation a minute later would produce a different one.
 */
function resolvedConfig(mobile) {
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

/** `method: app-store-connect` plus an explicit profile — the manual-signing half. */
function exportOptions({ bundleId, teamId, profile }) {
  const entries = [
    ["method", "app-store-connect"],
    ["teamID", teamId],
    ["signingStyle", "manual"],
  ]
    .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${entries}
  <key>provisioningProfiles</key>
  <dict>
    <key>${bundleId}</key>
    <string>${profile}</string>
  </dict>
  <key>uploadSymbols</key>
  <true/>
</dict>
</plist>
`;
}

export default {
  id: "ios",
  label: "iOS (App Store Connect)",
  status: "ready",

  preflight: [xcodeSelected, cocoapods, ...signing, ...ascKey],

  tiers: {
    alpha: {
      name: "internal TestFlight",
      requires: [],
      manual: [
        "testers must be App Store Connect users (≤100)",
        // True at every rung, including this one: until the plist key is set, the build
        // sits at Missing Compliance and cannot be distributed to anyone at all.
        "export compliance is asked in App Store Connect on every upload",
      ],
    },
    beta: {
      name: "external TestFlight",
      requires: [appIcon, exportCompliance],
      manual: [
        "Beta App Review — roughly a day on the first build of a version",
        'a beta description and "What to Test", both App Store Connect-side',
      ],
    },
    rc: {
      name: "external TestFlight (ship-ready)",
      requires: [appIcon, exportCompliance],
      manual: ["the crucial-flow catalog green on a real device"],
    },
    final: {
      name: "App Store review",
      requires: [appIcon, exportCompliance],
      manual: [
        "screenshots, privacy labels, age rating and a support URL in App Store Connect",
        "this version string is spent permanently once submitted",
      ],
    },
  },

  /**
   * Generate the native project, archive it, export a signed `.ipa`.
   *
   * The prebuild is preceded by deleting `ios/` outright rather than merging into it.
   * A release has to be reproducible from a commit, and a directory that has accumulated
   * whatever a previous build or an Xcode session left behind is not that. It costs the
   * developer a re-prebuild afterwards, which is the correct trade for an artifact that
   * goes to strangers.
   */
  async build({ root, storeVersion, tag }) {
    const mobile = MOBILE(root);
    const buildDir = join(mobile, "build");
    const teamId = process.env.APPLE_TEAM_ID.trim();
    const profile = process.env.IOS_PROVISIONING_PROFILE.trim();

    const config = resolvedConfig(mobile);
    const buildNumber = config.ios?.buildNumber;
    const bundleId = config.ios?.bundleIdentifier;
    if (!buildNumber || !bundleId) {
      throw new Error(
        "expo config resolved no ios.buildNumber/bundleIdentifier — check apps/mobile/app.config.ts",
      );
    }
    // The version Expo resolved and the version the tag names must be the same number, or
    // the artifact would carry a store version the release does not know it shipped.
    if (config.version !== storeVersion) {
      throw new Error(
        `expo resolved version ${config.version} but ${tag} means ${storeVersion} — apps/mobile/package.json and the tag disagree`,
      );
    }
    console.log(`   ${bundleId} ${config.version} (${buildNumber})`);

    rmSync(buildDir, { recursive: true, force: true });
    rmSync(join(mobile, "ios"), { recursive: true, force: true });
    mkdirSync(buildDir, { recursive: true });

    must(
      "expo prebuild",
      "pnpm",
      ["exec", "expo", "prebuild", "--platform", "ios"],
      {
        cwd: mobile,
        env: { ...process.env, LEAPSAKE_BUILD_NUMBER: String(buildNumber) },
      },
    );

    const workspace = readdirSync(join(mobile, "ios")).find((entry) =>
      entry.endsWith(".xcworkspace"),
    );
    if (!workspace) throw new Error("expo prebuild produced no .xcworkspace");
    const scheme = workspace.replace(/\.xcworkspace$/, "");
    const archivePath = join(buildDir, `${scheme}.xcarchive`);

    must("xcodebuild archive", "xcodebuild", [
      "-workspace",
      join(mobile, "ios", workspace),
      "-scheme",
      scheme,
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archivePath,
      // Signing is supplied here and nowhere else: the native project is regenerated
      // every build, so anything it claims about signing is discarded before this runs.
      `DEVELOPMENT_TEAM=${teamId}`,
      "CODE_SIGN_STYLE=Manual",
      "CODE_SIGN_IDENTITY=Apple Distribution",
      `PROVISIONING_PROFILE_SPECIFIER=${profile}`,
      "archive",
    ]);

    const optionsPath = join(buildDir, "ExportOptions.plist");
    writeFileSync(optionsPath, exportOptions({ bundleId, teamId, profile }));
    const exportPath = join(buildDir, "export");

    must("xcodebuild -exportArchive", "xcodebuild", [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      optionsPath,
    ]);

    const ipa = readdirSync(exportPath).find((entry) => entry.endsWith(".ipa"));
    if (!ipa) throw new Error(`no .ipa in ${exportPath}`);
    return { ipa: join(exportPath, ipa), buildNumber };
  },

  /**
   * Validate, then upload, with an App Store Connect API key.
   *
   * Validation first because it is the cheap half: it catches a rejected bundle before the
   * upload rather than leaving a build sitting in App Store Connect in a state that has to
   * be cleaned up by hand.
   */
  async publish({ artifact }) {
    const keyPath = process.env.ASC_KEY_PATH.trim();
    // altool locates the key by name inside a directory, so it is told the directory and
    // the key id rather than the path — see the ASC_KEY_PATH check above.
    const env = {
      ...process.env,
      API_PRIVATE_KEYS_DIR: dirname(resolve(keyPath)),
    };
    const credentials = [
      "--apiKey",
      process.env.ASC_KEY_ID.trim(),
      "--apiIssuer",
      process.env.ASC_ISSUER_ID.trim(),
    ];

    must(
      "altool --validate-app",
      "xcrun",
      [
        "altool",
        "--validate-app",
        "--type",
        "ios",
        "--file",
        artifact.ipa,
        ...credentials,
      ],
      { env },
    );

    must(
      "altool --upload-app",
      "xcrun",
      [
        "altool",
        "--upload-app",
        "--type",
        "ios",
        "--file",
        artifact.ipa,
        ...credentials,
      ],
      { env },
    );

    console.log(
      `   uploaded build ${artifact.buildNumber} — App Store Connect takes a few minutes to finish processing it`,
    );
  },
};
