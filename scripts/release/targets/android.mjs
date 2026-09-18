// The Android target: Google Play, via a local bundle. `expo prebuild` generates the
// project, `./gradlew bundleRelease` signs an AAB with the upload key, and `play.mjs`
// puts it on a track through the Developer API.
//
// Two constraints shape this file, both the same ones `ios.mjs` states:
//
//  1. **`apps/mobile/android/` is generated** by `expo prebuild` and gitignored. Nothing
//     originates there — the signing config is injected by
//     `plugins/with-android-release-signing.js` and reads credentials from the environment
//     at Gradle time.
//  2. **A stale native tree is the trap, not a missing one.** `app.config.ts` bakes the
//     version code and the commit at *prebuild* time, so a months-old `android/` ships
//     months-old values from a current checkout. Hence `--clean`, always.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { envSet, fileAt } from "../checks.mjs";
import { MOBILE, appIcon, must, pinnedConfig } from "../mobile.mjs";
import { playFromEnv } from "../play.mjs";

// ⚠️ **The rung named `beta` ships to the API track named `alpha`.** Play's closed testing
// track is called "Alpha" in the Console and `alpha` over the API; its `beta` is *open*
// testing, which no rung here uses. Confirmed against this app's own `edits.tracks.list`
// on 2026-09-16 — Google's "APKs and Tracks" page is not a reliable source for this and
// calls the internal track `qa`, which the same call disproves.
const TRACK = {
  internal: "internal",
  closed: "alpha",
  production: "production",
};

const ANDROID = (root) => join(MOBILE(root), "android");
const AAB = (root) =>
  join(ANDROID(root), "app/build/outputs/bundle/release/app-release.aab");

// The upload key's certificate, as Play itself reports it. A fingerprint, not a secret —
// checking it here is what catches a debug-signed release AAB, which builds and installs
// cleanly and is only rejected at upload.
const UPLOAD_KEY_SHA256 =
  "61:B6:0B:A8:D5:FE:D8:FD:F2:6D:89:30:87:68:7A:39:7A:70:29:B7:DF:00:FF:0E:8D:09:7A:B0:40:C1:73:D4";

const signing = [
  fileAt("LEAPSAKE_ANDROID_KEYSTORE", "Gradle signs the AAB with it"),
  envSet(
    "LEAPSAKE_ANDROID_KEY_ALIAS",
    "it names which key in the keystore to use",
  ),
  fileAt(
    "LEAPSAKE_ANDROID_KEYSTORE_PASSWORD_PATH",
    "the password is read from a file and passed to Gradle in its environment",
  ),
];

/**
 * Ask Play whether it would accept an edit shaped like this release's, before anything is
 * built.
 *
 * **Both Console gates that have bitten refused the edit *commit*** — `Only releases with
 * status draft may be created on draft app`, and `You must declare the use of advertising ID
 * in Play Console` — which is the far side of the suite, the Gradle build and a completed
 * upload. This asks the same question for the price of two API calls: open an edit, write the
 * track's own releases back to it unchanged, and `:validate` instead of committing. Nothing is
 * committed and no version code is spent, because `withEdit({ commit: false })` abandons it.
 *
 * ⚠️ **A green here is not proof that a commit would succeed.** Whether `:validate` reports
 * *these particular* refusals is unverified: both are one-time-per-app, the app now satisfies
 * both, and neither can be reproduced without breaking a declaration on a live listing. So
 * this is a cheap net for the class, not a guarantee — if a `:commit` is ever refused while
 * this passed, the fallback is a preflight that reads *App content* state directly, and that
 * finding belongs in `plans/android-pipeline.md`.
 *
 * Skipped silently without credentials: `serviceAccount` is the check that owns that failure.
 */
const consolePreconditions = (track) => ({
  name: "Play Console preconditions",
  check: async ({ root }) => {
    if (!process.env.PLAY_SERVICE_ACCOUNT_PATH?.trim()) return undefined;
    const packageName = readPackageName(root);
    try {
      const play = playFromEnv();
      await play.withEdit(
        packageName,
        async (editId) => {
          const edit = `${play.app(packageName)}/edits/${editId}`;
          const current = await play.get(`${edit}/tracks/${track}`);
          // A track Play has never released to answers with no releases; writing an empty
          // array back is not the shape a real publish takes, so send nothing instead.
          if (current.releases?.length) {
            await play.put(`${edit}/tracks/${track}`, {
              body: { track, releases: current.releases },
            });
          }
          await play.post(`${edit}:validate`);
        },
        { commit: false },
      );
      return undefined;
    } catch (error) {
      return (
        `Play would refuse this release on the ${track} track: ${error.message}. ` +
        "This is a Console answer, not a repo one — fix it under Policy → App content, " +
        "then re-run."
      );
    }
  },
});

const serviceAccount = fileAt(
  "PLAY_SERVICE_ACCOUNT_PATH",
  "the upload authenticates with it — see .env.example",
  { suffix: ".json" },
);

/** A JDK, which `./gradlew` needs. Checked before a prebuild that deletes the project. */
const java = {
  name: "Java",
  check: () => {
    try {
      execFileSync("java", ["-version"], { stdio: "ignore" });
      return undefined;
    } catch {
      return "`java` is not on PATH — ./gradlew needs a JDK (brew install --cask temurin)";
    }
  },
};

/**
 * One live Play call, so a wrong grant is reported before a four-minute Gradle build
 * rather than after it. Mirrors the App Store Connect check in `ios.mjs`.
 */
const playReachable = {
  name: "Play API",
  check: async ({ root }) => {
    if (!process.env.PLAY_SERVICE_ACCOUNT_PATH?.trim()) return undefined;
    const packageName = readPackageName(root);
    try {
      const play = playFromEnv();
      await play.withEdit(
        packageName,
        (editId) => play.get(`${play.app(packageName)}/edits/${editId}/tracks`),
        { commit: false },
      );
      return undefined;
    } catch (error) {
      return `could not reach ${packageName} with this service account: ${error.message}`;
    }
  },
};

/**
 * Production access, which a personal account earns by running a closed test.
 *
 * This is the check that stops a half-finished cross-platform release: without it `final`
 * would ship iOS and *then* discover Android cannot go live. It fails in the preflight
 * pass, before anything is built.
 */
const productionAccess = {
  name: "production access",
  check: () =>
    "Play has not granted this account production access yet — it is earned by 12 testers " +
    "opted into the closed track for 14 continuous days, then applied for. Until then " +
    "`final` cannot publish on Android. Ship iOS with `--only=ios` if that is what you mean.",
};

/**
 * Play's release notes, which come from `whats-new.txt` at *every* rung.
 *
 * ⚠️ Not `what-to-test.txt`, which is the iOS pairing. Apple has two fields — TestFlight's
 * "What to Test" for testers and the App Store's "What's New" for the public — and the
 * rungs pick between them. Play has one field, shown in the store listing, so the store
 * copy is the right source even on a testing track.
 */
const NOTES = (root) => join(root, "release-notes", "whats-new.txt");
// Play's documented limit: 500 Unicode characters per language, counted as code points.
const NOTES_MAX = 500;

const releaseNotes = {
  name: "release notes",
  check: ({ root }) => {
    const path = NOTES(root);
    if (!existsSync(path)) {
      return "release-notes/whats-new.txt is missing — Play shows it as the release's notes";
    }
    const text = readFileSync(path, "utf8").trim();
    if (!text) return "release-notes/whats-new.txt is empty";
    const length = [...text].length;
    if (length > NOTES_MAX) {
      return `release-notes/whats-new.txt is ${length} characters — Play allows ${NOTES_MAX}`;
    }
    return undefined;
  },
};

const readPackageName = (root) =>
  JSON.parse(readFileSync(join(MOBILE(root), "app.json"), "utf8")).expo?.android
    ?.package;

const TIERS = {
  alpha: {
    name: "internal testing track",
    track: TRACK.internal,
    requires: [consolePreconditions(TRACK.internal)],
    manual: [
      "internal releases bypass managed publishing and go out immediately",
    ],
  },
  beta: {
    name: "closed testing track",
    track: TRACK.closed,
    requires: [appIcon, releaseNotes, consolePreconditions(TRACK.closed)],
    manual: [
      "Play reviews a closed-track rollout; there is no separate submit step",
      "the 12-tester/14-day closed test gates *production access* — these uploads are " +
        "what earn it, so shipping betas is the path to production rather than a detour",
    ],
  },
  // `rc` means "closed track, plus a production release held for manual publishing" —
  // ⚠️ but the production half needs production access, which this account does not have.
  // Until it does, `rc` is `beta` with a louder notice rather than a refusal, so an
  // iOS `rc` is not blocked by an Android rung that cannot exist yet.
  rc: {
    name: "closed testing track (no production hold yet)",
    track: TRACK.closed,
    requires: [appIcon, releaseNotes, consolePreconditions(TRACK.closed)],
    manual: [
      "⚠️ Android gets the closed track ONLY — the held production release `rc` means on " +
        "iOS needs production access, and managed publishing turned on before it",
    ],
  },
  final: {
    name: "production track",
    track: TRACK.production,
    requires: [productionAccess, consolePreconditions(TRACK.production)],
    manual: [],
  },
};

export default {
  id: "android",
  label: "Android (Google Play)",
  status: "ready",

  preflight: [java, ...signing, serviceAccount, playReachable],

  tiers: TIERS,

  /**
   * Generate the native project, build a signed AAB, and verify what it claims.
   *
   * Both verifications happen before the upload because each catches a different
   * disaster: a bundle signed by the wrong key is rejected at upload, and one that names
   * the wrong commit is accepted and unprovable.
   */
  async build({ root, storeVersion, tag }) {
    const mobile = MOBILE(root);
    const config = pinnedConfig(mobile);
    const versionCode = config.android?.versionCode;
    const packageName = config.android?.package;
    if (!versionCode || !packageName) {
      throw new Error(
        "expo config resolved no android.versionCode/package — check apps/mobile/app.config.ts",
      );
    }
    if (config.version !== storeVersion) {
      throw new Error(
        `expo resolved version ${config.version} but ${tag} means ${storeVersion} — apps/mobile/package.json and the tag disagree`,
      );
    }
    console.log(`   ${packageName} ${config.version} (${versionCode})`);

    rmSync(ANDROID(root), { recursive: true, force: true });
    must(
      "expo prebuild",
      "pnpm",
      ["exec", "expo", "prebuild", "--platform", "android", "--clean"],
      {
        cwd: mobile,
        env: { ...process.env, LEAPSAKE_BUILD_NUMBER: String(versionCode) },
      },
    );

    // The commit is baked at prebuild time, so this is checkable before spending four
    // minutes on Gradle.
    const manifest = readFileSync(
      join(ANDROID(root), "app/src/main/AndroidManifest.xml"),
      "utf8",
    );
    const baked = /android:name="LeapsakeCommit" android:value="([^"]*)"/.exec(
      manifest,
    )?.[1];
    if (!baked) {
      throw new Error(
        "the generated AndroidManifest.xml names no LeapsakeCommit — plugins/with-android-commit.js did not run",
      );
    }
    if (baked.endsWith("-dirty")) {
      throw new Error(
        `the build would claim commit ${baked} — the tree is not clean`,
      );
    }
    console.log(`   manifest names ${baked}`);

    const password = readFileSync(
      process.env.LEAPSAKE_ANDROID_KEYSTORE_PASSWORD_PATH.trim(),
      "utf8",
    ).trim();
    must("./gradlew bundleRelease", "./gradlew", ["bundleRelease"], {
      cwd: ANDROID(root),
      env: {
        ...process.env,
        // The password reaches Gradle through the child environment and nowhere else —
        // `.env` holds its *path*, never the secret.
        LEAPSAKE_ANDROID_KEYSTORE_PASSWORD: password,
      },
    });

    const aab = AAB(root);
    if (!existsSync(aab)) throw new Error(`gradle produced no AAB at ${aab}`);
    assertSignedByUploadKey(aab);

    return { aab, buildNumber: versionCode, bundleId: packageName };
  },

  /**
   * Upload the AAB and put it on this rung's track, in one edit.
   *
   * One edit updating one track is also what keeps `rc` honest later: when the production
   * half becomes possible it adds a second `tracks.update` to the *same* edit rather than
   * a second upload, so one version code covers both.
   */
  async publish({ artifact, root, stage, version }) {
    const tier = TIERS[stage];
    const play = playFromEnv();
    const app = play.app(artifact.bundleId);
    const notes = readFileSync(NOTES(root), "utf8").trim();

    await play.withEdit(artifact.bundleId, async (editId) => {
      const bundle = await play.uploadBundle(
        artifact.bundleId,
        editId,
        artifact.aab,
      );
      if (bundle.versionCode !== artifact.buildNumber) {
        throw new Error(
          `uploaded version code ${bundle.versionCode} is not the ${artifact.buildNumber} that was built`,
        );
      }
      console.log(`   uploaded version code ${bundle.versionCode}`);

      await play.put(`${app}/edits/${editId}/tracks/${tier.track}`, {
        body: {
          track: tier.track,
          releases: [
            {
              // Without this Play names the release from the versionName, which is the
              // store version — so every rung of 0.1.0 would read "0.1.0" in the Console.
              name: version,
              status: "completed",
              versionCodes: [String(bundle.versionCode)],
              releaseNotes: [{ language: "en-US", text: notes }],
            },
          ],
        },
      });
    });

    console.log(`   rolled out to the ${tier.track} track`);
  },
};

/**
 * Assert the AAB carries the upload key's certificate.
 *
 * `keytool -printcert -jarfile` reads the signature block out of the bundle without
 * needing `bundletool`; `aapt2` cannot, because an AAB has no root binary manifest.
 */
function assertSignedByUploadKey(aab) {
  const printed = execFileSync("keytool", ["-printcert", "-jarfile", aab], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  const found = /SHA256:\s*([0-9A-F:]{95})/i.exec(printed)?.[1];
  if (!found) {
    throw new Error(`keytool reported no SHA-256 fingerprint for ${aab}`);
  }
  if (found.toUpperCase() !== UPLOAD_KEY_SHA256) {
    throw new Error(
      `${aab} is signed by ${found}, not the upload key ${UPLOAD_KEY_SHA256} — ` +
        "a debug-signed release AAB looks fine until Play rejects it",
    );
  }
}
