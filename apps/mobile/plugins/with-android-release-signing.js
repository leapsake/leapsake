const { withAppBuildGradle } = require("@expo/config-plugins");

// Signs Android releases with the Play upload key from the environment; with
// none, unsigned, never debug-signed (the README → What the build stamps).

// Both injected blocks carry this, which makes a second prebuild a no-op.
const MARKER = "with-android-release-signing.js";

// Unique only with the brace: `signingConfigs` alone appears elsewhere too.
const CONFIGS_ANCHOR = "signingConfigs {";

// ⚠️ The comment and the line: the bare line is in `buildTypes.debug` too,
// which must keep it.
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
            def leapsakeStore = System.getenv("LEAPSAKE_ANDROID_SIGNING_KEYSTORE")
            if (leapsakeStore) {
                storeFile file(leapsakeStore)
                storePassword System.getenv("LEAPSAKE_ANDROID_SIGNING_KEYSTORE_PASSWORD")
                keyAlias System.getenv("LEAPSAKE_ANDROID_SIGNING_KEY_ALIAS")
                // keytool's default keystore format is PKCS12, which requires the key
                // password to equal the store password — so one supplied value covers
                // both, and the separate variable exists only for a JKS keystore that
                // predates that default.
                keyPassword System.getenv("LEAPSAKE_ANDROID_SIGNING_KEY_PASSWORD") ?: System.getenv("LEAPSAKE_ANDROID_SIGNING_KEYSTORE_PASSWORD")
            }
        }`;

const RELEASE_SIGNING = `            // Injected by plugins/${MARKER}.
            //
            // Deliberately NOT a fallback to signingConfigs.debug: a debug-signed release
            // build is the failure that looks like success. Unsigned fails loudly instead.
            signingConfig System.getenv("LEAPSAKE_ANDROID_SIGNING_KEYSTORE") ? signingConfigs.release : null`;

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
