// The Android target: Google Play from a local bundle. See
// `scripts/release/README.md` → _The Android target_.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { envSet, fileAt } from "../checks.mjs";
import { MOBILE, appIcon, must, pinnedConfig } from "../mobile.mjs";
import { googlePlayFromEnv } from "../google-play.mjs";
import { BUNDLE_IN, assertNoTestOnlyCode } from "../test-only.mjs";

// ⚠️ The `beta` rung ships to the API's `alpha` track, Play's closed testing;
// see `apps/mobile/README.md`.
const TRACK = {
  internal: "internal",
  closed: "alpha",
  production: "production",
};

const ANDROID = (root) => join(MOBILE(root), "android");
const AAB = (root) =>
  join(ANDROID(root), "app/build/outputs/bundle/release/app-release.aab");

// The upload key's certificate fingerprint, which catches a debug-signed AAB.
const UPLOAD_KEY_SHA256 =
  "61:B6:0B:A8:D5:FE:D8:FD:F2:6D:89:30:87:68:7A:39:7A:70:29:B7:DF:00:FF:0E:8D:09:7A:B0:40:C1:73:D4";

const signing = [
  fileAt("GOOGLE_PLAY_UPLOAD_KEYSTORE", "Gradle signs the AAB with it"),
  envSet(
    "GOOGLE_PLAY_UPLOAD_KEY_ALIAS",
    "it names which key in the keystore to use",
  ),
  fileAt(
    "GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD_PATH",
    "the password is read from a file and passed to Gradle in its environment",
  ),
];

/** Asks Play to `:validate` an unchanged edit before building; ⚠️ a cheap
 *  net, not proof. See `apps/mobile/README.md`. */
const consolePreconditions = (track) => ({
  name: "Play Console preconditions",
  check: async ({ root }) => {
    if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH?.trim()) return undefined;
    const packageName = readPackageName(root);
    try {
      const googlePlay = googlePlayFromEnv();
      await googlePlay.withEdit(
        packageName,
        async (editId) => {
          const edit = `${googlePlay.app(packageName)}/edits/${editId}`;
          const current = await googlePlay.get(`${edit}/tracks/${track}`);
          // A never-released track has none; send nothing, not an empty array.
          if (current.releases?.length) {
            await googlePlay.put(`${edit}/tracks/${track}`, {
              body: { track, releases: current.releases },
            });
          }
          await googlePlay.post(`${edit}:validate`);
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
  "GOOGLE_PLAY_SERVICE_ACCOUNT_PATH",
  "the upload authenticates with it — see .env.example",
  { suffix: ".json" },
);

/** A JDK for `./gradlew`, checked before the prebuild deletes the project. */
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

/** One live Play call, so a wrong grant shows before the Gradle build. */
const googlePlayReachable = {
  name: "Play API",
  check: async ({ root }) => {
    if (!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PATH?.trim()) return undefined;
    const packageName = readPackageName(root);
    try {
      const googlePlay = googlePlayFromEnv();
      await googlePlay.withEdit(
        packageName,
        (editId) =>
          googlePlay.get(
            `${googlePlay.app(packageName)}/edits/${editId}/tracks`,
          ),
        { commit: false },
      );
      return undefined;
    } catch (error) {
      return `could not reach ${packageName} with this service account: ${error.message}`;
    }
  },
};

/** Play's release notes: ⚠️ `whats-new.txt` at every rung, as Play has one
 *  field, shown in the listing. */
const NOTES = (root) => join(root, "release-notes", "whats-new.txt");
// Play's limit: 500 code points per language.
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
  // ⚠️ Without production access, `rc` is `beta` with a louder notice.
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
    status: "blocked",
    note:
      "Play has not granted this account production access yet — it is earned by 12 testers " +
      "opted into the closed track for 14 continuous days, then applied for",
    requires: [consolePreconditions(TRACK.production)],
    manual: [],
  },
};

export default {
  id: "android",
  label: "Android (Google Play)",
  platform: "android",
  host: "linux",
  status: "ready",

  preflight: [java, ...signing, serviceAccount, googlePlayReachable],

  tiers: TIERS,

  /** Prebuilds clean and builds a signed AAB, then verifies its commit and its
   *  key before any upload. */
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

    // Baked at prebuild, so checked before Gradle.
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
      process.env.GOOGLE_PLAY_UPLOAD_KEYSTORE_PASSWORD_PATH.trim(),
      "utf8",
    ).trim();
    must("./gradlew bundleRelease", "./gradlew", ["bundleRelease"], {
      cwd: ANDROID(root),
      env: {
        ...process.env,
        // The upload key; its password lives only in this child's environment.
        LEAPSAKE_ANDROID_SIGNING_KEYSTORE:
          process.env.GOOGLE_PLAY_UPLOAD_KEYSTORE.trim(),
        LEAPSAKE_ANDROID_SIGNING_KEY_ALIAS:
          process.env.GOOGLE_PLAY_UPLOAD_KEY_ALIAS.trim(),
        LEAPSAKE_ANDROID_SIGNING_KEYSTORE_PASSWORD: password,
      },
    });

    const aab = AAB(root);
    if (!existsSync(aab)) throw new Error(`gradle produced no AAB at ${aab}`);
    assertSignedByUploadKey(aab);
    assertNoTestOnlyCode(aab, BUNDLE_IN.aab);

    return { files: { aab }, buildNumber: versionCode, bundleId: packageName };
  },

  /** Uploads the AAB onto this rung's track in one edit. */
  async publish({ artifact, root, stage, version }) {
    const tier = TIERS[stage];
    const googlePlay = googlePlayFromEnv();
    const app = googlePlay.app(artifact.bundleId);
    const notes = readFileSync(NOTES(root), "utf8").trim();

    await googlePlay.withEdit(artifact.bundleId, async (editId) => {
      const bundle = await googlePlay.uploadBundle(
        artifact.bundleId,
        editId,
        artifact.files.aab,
      );
      if (bundle.versionCode !== artifact.buildNumber) {
        throw new Error(
          `uploaded version code ${bundle.versionCode} is not the ${artifact.buildNumber} that was built`,
        );
      }
      console.log(`   uploaded version code ${bundle.versionCode}`);

      await googlePlay.put(`${app}/edits/${editId}/tracks/${tier.track}`, {
        body: {
          track: tier.track,
          releases: [
            {
              // Else every rung of a version reads alike in the Console.
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

/** Asserts the AAB's certificate is the upload key's, via `keytool`, as
 *  `aapt2` cannot read an AAB. */
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
