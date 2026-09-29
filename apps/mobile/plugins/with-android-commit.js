const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

// Stamps the commit `app.config.ts` resolved into the Android manifest, where
// an AAB names its source unlaunched (the README → What the build stamps).

/** The manifest key; iOS' `Info.plist` uses it too, so one grep finds both. */
const NAME = "LeapsakeCommit";

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidCommit = (config) =>
  withAndroidManifest(config, (mod) => {
    const commit = mod.extra?.commit;

    // Absent, not "unknown", means a config that skipped `app.config.ts`:
    // throw rather than ship a provenance element that says nothing.
    if (typeof commit !== "string" || commit === "") {
      throw new Error(
        "with-android-commit: the resolved config carries no `extra.commit`, so the " +
          "manifest would claim no commit at all. `apps/mobile/app.config.ts` sets it — " +
          "check that the dynamic config is being evaluated rather than app.json alone.",
      );
    }

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );

    // Idempotent by rewrite, not early return: a stale commit would name the
    // wrong source with full confidence.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      NAME,
      commit,
    );

    return mod;
  });

module.exports = withAndroidCommit;
