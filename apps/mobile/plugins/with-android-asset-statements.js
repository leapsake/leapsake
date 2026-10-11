const {
  AndroidConfig,
  withAndroidManifest,
  withStringsXml,
} = require("@expo/config-plugins");

// Points Android at leapsake.com's `assetlinks.json`, so autofill files the
// app's credentials under the site, as iOS does through `webcredentials`.

const NAME = "asset_statements";
// Backslashed, since a string resource drops bare double quotes.
const STATEMENTS = JSON.stringify([
  { include: "https://leapsake.com/.well-known/assetlinks.json" },
]).replaceAll('"', '\\"');

/** @type {import("@expo/config-plugins").ConfigPlugin} */
const withAndroidAssetStatements = (config) => {
  config = withStringsXml(config, (mod) => {
    mod.modResults = AndroidConfig.Strings.setStringItem(
      [{ $: { name: NAME, translatable: "false" }, _: STATEMENTS }],
      mod.modResults,
    );
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults),
      NAME,
      `@string/${NAME}`,
      "resource",
    );
    return mod;
  });
};

module.exports = withAndroidAssetStatements;
