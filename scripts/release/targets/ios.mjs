// The iOS target: App Store Connect, via a local archive.
//
// `status: "blocked"` until `build`/`publish` below are real. The preflights *are* real
// already and run under `--dry-run`, which is the point of shipping this half first —
// it answers "what is missing before I can cut a beta?" without an Xcode session.
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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { envSet, fileAt } from "../checks.mjs";

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

// One App Store Connect API key covers the upload here and macOS notarization later, and
// unlike an Apple ID session it runs unattended.
const ascKey = [
  fileAt("ASC_KEY_PATH", "the upload authenticates with it", { suffix: ".p8" }),
  envSet("ASC_KEY_ID", "it identifies which App Store Connect key is in use"),
  envSet("ASC_ISSUER_ID", "App Store Connect keys are scoped to an issuer"),
];

export default {
  id: "ios",
  label: "iOS (App Store Connect)",
  status: "blocked",
  note: "archive/export/upload not scripted yet — plans/ios-release-pipeline.md",

  preflight: [xcodeSelected, ...signing, ...ascKey],

  tiers: {
    alpha: {
      name: "internal TestFlight",
      requires: [],
      manual: ["testers must be App Store Connect users (≤100)"],
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

  async build() {
    throw new Error(
      "the iOS archive is not scripted yet — see plans/ios-release-pipeline.md",
    );
  },

  async publish() {
    throw new Error(
      "the iOS upload is not scripted yet — see plans/ios-release-pipeline.md",
    );
  },
};
