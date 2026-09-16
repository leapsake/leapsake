const { AndroidConfig, withAndroidManifest } = require("@expo/config-plugins");

/**
 * Bake the commit into the shipped `AndroidManifest.xml`, so an AAB can name the source it
 * was built from **without being launched**.
 *
 * ## Why this exists
 *
 * The build number is a clock reading (`app.config.ts` → `buildNumber`), which is what makes
 * it collision-free and impossible to forget — and also what makes it opaque: given a build
 * in the Play Console there is no way back to the source. iOS solved this already, by baking
 * `LeapsakeCommit` into the shipped `Info.plist`, where `plutil -p` reads it straight out of
 * an `.ipa`. Android had no equivalent: `app.config.ts`'s `android` block set only
 * `versionCode`, so the claim fell back to `extra.commit` in the JS bundle — which requires
 * the app to *run*.
 *
 * **That dependency is the whole problem.** A provenance claim has to survive the app being
 * unable or unwilling to report on itself; one that needs a working launch is worth little
 * when you are trying to establish what a broken build contains. This element is readable
 * from the shipped bundle with nothing executing.
 *
 * ## How to read it back — and the tool that does NOT work
 *
 * ⚠️ **Not `aapt2 dump badging`.** That is what this plugin's own plan said, and it is wrong
 * for an AAB: `aapt2` answers `error: could not identify format of APK`, because a bundle is
 * a zip of protobuf modules with no root binary manifest to badge. `aapt2 dump xmltree` on
 * the extracted manifest fails for the same reason. Both work fine on an *APK* — which is
 * why the claim survived unchallenged until an AAB was actually built (2026-09-15).
 *
 * What works with nothing installed:
 *
 * ```sh
 * unzip -p app-release.aab base/manifest/AndroidManifest.xml | strings | grep -A2 LeapsakeCommit
 * ```
 *
 * That is a *heuristic*, not a parse — the manifest is protobuf, so `strings` recovers the
 * attribute name and its value as adjacent tokens with no structural link between them. It
 * is enough to prove the element shipped. The rigorous form is `bundletool dump manifest
 * --bundle=app-release.aab`, which parses it properly; bundletool is a separate install
 * (`brew install bundletool`) and is not required by anything else here.
 *
 * ## Why the value is read from the config rather than from git
 *
 * `app.config.ts` already resolves the commit — including the `LEAPSAKE_COMMIT` /
 * `GITHUB_SHA` overrides that let a runner or a rebuild reproduce a known artifact's
 * identity, and the `-dirty` suffix that admits a build bypassed the release path. Shelling
 * out to git here would be a **second** source that can disagree with `extra.commit` and with
 * iOS' `Info.plist`, which is exactly the duplication that file exists to prevent. One
 * reading, three places it lands.
 *
 * ## Why a config plugin
 *
 * `android/` is `expo prebuild` output and gitignored, so nothing may originate there — the
 * same rule `with-android-release-signing.js` and `with-store-backup-exclusion.js` state.
 * Anything written into the generated project by hand is erased by the next prebuild.
 *
 * ⚠️ Like its siblings, this **throws rather than skipping** when it cannot do its job. A
 * provenance marker that silently no-ops is worse than one that is absent: the absence is
 * visible in `aapt2 dump badging`, the no-op is not, and the artifact still looks signed and
 * shippable while claiming nothing. `getMainApplicationOrThrow` supplies half of that; the
 * missing-commit guard below supplies the other half.
 */

/** The manifest key. Matches iOS' `Info.plist` key exactly, so one grep finds both. */
const NAME = "LeapsakeCommit";

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidCommit = (config) =>
  withAndroidManifest(config, (mod) => {
    const commit = mod.extra?.commit;

    // `commitSha()` never throws — a build from a source tarball with no git says "unknown"
    // rather than failing, and that is deliberate. So the value being *absent entirely* is a
    // different fault: it means this plugin is running against a config that never went
    // through `app.config.ts`, and writing `undefined` into the manifest would produce an
    // artifact whose provenance element exists and says nothing.
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

    // Idempotent by rewrite rather than by early return: `expo prebuild` is routinely re-run
    // over an existing project, and a *stale* commit is worse than a missing one — it names
    // the wrong source with full confidence. The helper replaces an existing item of the
    // same name, so re-running always leaves the current value.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      application,
      NAME,
      commit,
    );

    return mod;
  });

module.exports = withAndroidCommit;
