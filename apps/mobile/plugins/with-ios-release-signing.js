const { withXcodeProject } = require("@expo/config-plugins");

// Gives each target's Release build its own App Store profile, named in the
// environment; with none set, signing is left as Expo generates it.

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withIosReleaseSigning = (config) =>
  withXcodeProject(config, (mod) => {
    const app = mod.ios?.bundleIdentifier;
    const profiles = {
      [app]: process.env.APPLE_IOS_PROVISIONING_PROFILE?.trim(),
      [`${app}.share-extension`]:
        process.env.APPLE_IOS_SHARE_EXTENSION_PROVISIONING_PROFILE?.trim(),
    };
    const configurations = mod.modResults.pbxXCBuildConfigurationSection();
    for (const { name, buildSettings } of Object.values(configurations)) {
      if (name !== "Release" || !buildSettings) continue;
      const bundleId = buildSettings.PRODUCT_BUNDLE_IDENTIFIER?.replace(
        /"/g,
        "",
      );
      const profile = profiles[bundleId];
      if (profile)
        buildSettings.PROVISIONING_PROFILE_SPECIFIER = `"${profile}"`;
    }
    return mod;
  });

module.exports = withIosReleaseSigning;
