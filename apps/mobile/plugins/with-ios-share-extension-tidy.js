const {
  withEntitlementsPlist,
  withXcodeProject,
} = require("@expo/config-plugins");
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const plist = require("@expo/plist").default;

// Tidies after expo-share-intent, so is listed before it: names the share
// extension after the app, and drops the group it re-adds on every prebuild.

const INFO = join("ShareExtension", "ShareExtension-Info.plist");
const GROUPS = "com.apple.security.application-groups";

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withIosShareExtensionTidy = (config) => {
  config = withEntitlementsPlist(config, (mod) => {
    const groups = mod.modResults[GROUPS];
    if (Array.isArray(groups)) mod.modResults[GROUPS] = [...new Set(groups)];
    return mod;
  });
  return withXcodeProject(config, (mod) => {
    const path = join(mod.modRequest.platformProjectRoot, INFO);
    const info = plist.parse(readFileSync(path, "utf8"));
    info.CFBundleDisplayName = mod.name;
    writeFileSync(path, plist.build(info));
    return mod;
  });
};

module.exports = withIosShareExtensionTidy;
