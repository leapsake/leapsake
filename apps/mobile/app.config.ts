import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

/**
 * Expo's **dynamic config**. The static half stays in `app.json` — name, slug, scheme,
 * bundle identifiers, plugins — and this injects the one field that must not be
 * duplicated anywhere: the version.
 *
 * Expo reads `app.json` first and hands it in as `config`, so this is a one-field
 * override rather than a second copy of the manifest. The version comes from this app's
 * `package.json`, which `scripts/set-version.mjs` writes along with every other manifest
 * in the workspace; `pnpm test:versions` fails if `app.json` ever grows an `expo.version`
 * again, since that would quietly become a second source.
 *
 * Why it matters more here than elsewhere: `expo.version` is the **user-visible store
 * version string** on both platforms, and store versions are permanent and monotonic.
 * A bump that updated `package.json` but not `app.json` would ship the wrong number to
 * a store record that can never go backwards.
 *
 * Build numbers (`ios.buildNumber`, `android.versionCode`) are deliberately *not* set
 * here — they are per-upload rather than per-release, and belong to the EAS pipeline
 * (Increment 4), which can auto-increment them.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Leapsake",
  slug: config.slug ?? "leapsake",
  version: pkg.version,
});
