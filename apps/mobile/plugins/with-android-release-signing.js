const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Sign Android release builds with the Play **upload key** rather than the debug key.
 *
 * Expo's SDK 56 template ships `buildTypes.release { signingConfig signingConfigs.debug }`
 * with a comment telling you to fix it in production. Left alone, `./gradlew bundleRelease`
 * produces an AAB signed with the checked-in `debug.keystore` — which Play rejects, and
 * which would be a disaster if it were ever accepted, since the debug key is public.
 *
 * It is a config plugin rather than a hand edit for the same reason
 * `with-store-backup-exclusion.js` is: `android/` is `expo prebuild` output and gitignored,
 * so anything written there directly is erased by the next prebuild. The rule the iOS
 * target states — *nothing may originate in the generated native project* — applies here
 * word for word, which is why the credentials arrive as environment variables at
 * invocation rather than sitting in `gradle.properties` or `app.json`.
 *
 * ## Why the key material is not in this file, or in any file the repo tracks
 *
 * `.env.example` states the principle: nothing secret belongs in `.env` itself, the
 * credentials are *files*, and the repo only names where they are. So the keystore is
 * referenced by path and its password is read from a file by whoever spawns Gradle —
 * `scripts/release/targets/android.mjs`, or a person exporting it for a one-off build.
 * This plugin only writes the code that *reads* those variables.
 *
 * ## Why a missing keystore leaves the build unsigned rather than debug-signed
 *
 * Gradle configures every build type on every invocation, including `assembleDebug`, so
 * this cannot throw when the variables are absent — that would break the ordinary dev
 * loop, which has no business holding a production signing key.
 *
 * What it must not do is **fall back to `signingConfigs.debug`**. That is the failure that
 * looks like success: a debug-signed release AAB builds cleanly, installs locally, and is
 * only rejected at the upload — or, worse, gets installed by a tester and establishes the
 * wrong signing identity for that device. Unsigned fails immediately and unmistakably, so
 * absent credentials produce `signingConfig null` and the build stops being shippable in a
 * way nobody can miss. The release path's own preflight is what turns that into a readable
 * error before a twenty-minute build rather than after it.
 *
 * ⚠️ Like its sibling, this **throws rather than skipping when an anchor is missing**. If a
 * future SDK reshapes `app/build.gradle`, the prebuild fails and asks to be re-pointed; it
 * does not quietly hand back a project that signs releases with a public key.
 */

// Both injected blocks carry this, so its presence is what makes a second prebuild a
// no-op. `expo prebuild` is routinely re-run over an existing project.
const MARKER = "with-android-release-signing.js";

// The `signingConfigs {` block opener. Unique with the brace — `signingConfigs` alone also
// appears in `signingConfigs.debug` and in what this plugin writes.
const CONFIGS_ANCHOR = "signingConfigs {";

// ⚠️ The anchor is the comment *plus* the line, because `signingConfig signingConfigs.debug`
// appears **twice** in the template — once in `buildTypes.debug`, where it is correct and
// must stay, and once in `buildTypes.release`, which is the one being replaced. Anchoring on
// the bare line would rewrite the debug build type as well.
const RELEASE_ANCHOR = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_CONFIG = `signingConfigs {
        // Injected by plugins/${MARKER} — edit it there, not here: this file is
        // \`expo prebuild\` output and anything changed directly is lost on the next run.
        //
        // Read from the environment rather than gradle.properties so that no signing
        // material originates in this generated, gitignored project. The password is
        // supplied by whoever spawns Gradle, from a file outside the repo.
        release {
            def leapsakeStore = System.getenv("LEAPSAKE_ANDROID_KEYSTORE")
            if (leapsakeStore) {
                storeFile file(leapsakeStore)
                storePassword System.getenv("LEAPSAKE_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("LEAPSAKE_ANDROID_KEY_ALIAS")
                // keytool's default keystore format is PKCS12, which requires the key
                // password to equal the store password — so one supplied value covers
                // both, and the separate variable exists only for a JKS keystore that
                // predates that default.
                keyPassword System.getenv("LEAPSAKE_ANDROID_KEY_PASSWORD") ?: System.getenv("LEAPSAKE_ANDROID_KEYSTORE_PASSWORD")
            }
        }`;

const RELEASE_SIGNING = `            // Injected by plugins/${MARKER}.
            //
            // Deliberately NOT a fallback to signingConfigs.debug: a debug-signed release
            // build is the failure that looks like success. Unsigned fails loudly instead.
            signingConfig System.getenv("LEAPSAKE_ANDROID_KEYSTORE") ? signingConfigs.release : null`;

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidReleaseSigning = (config) =>
  withAppBuildGradle(config, (mod) => {
    const { language } = mod.modResults;
    if (language !== "groovy") {
      throw new Error(
        `with-android-release-signing: expected a Groovy app/build.gradle, got "${language}". ` +
          "Re-point this plugin rather than letting releases be signed with the debug key.",
      );
    }

    if (mod.modResults.contents.includes(MARKER)) return mod;

    for (const [label, anchor] of [
      ["signingConfigs block", CONFIGS_ANCHOR],
      ["release build type", RELEASE_ANCHOR],
    ]) {
      if (!mod.modResults.contents.includes(anchor)) {
        throw new Error(
          `with-android-release-signing: could not find the ${label} anchor in ` +
            "android/app/build.gradle, so release builds would be signed with the public " +
            "debug key. The SDK template has changed — re-point the anchor in " +
            "apps/mobile/plugins/with-android-release-signing.js.",
        );
      }
    }

    mod.modResults.contents = mod.modResults.contents
      .replace(CONFIGS_ANCHOR, RELEASE_CONFIG)
      .replace(RELEASE_ANCHOR, RELEASE_SIGNING);

    return mod;
  });

module.exports = withAndroidReleaseSigning;
