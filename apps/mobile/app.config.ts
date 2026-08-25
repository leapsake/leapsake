import type { ConfigContext, ExpoConfig } from "expo/config";
import pkg from "./package.json";

/**
 * Expo's **dynamic config**. The static half stays in `app.json` — name, slug, scheme,
 * bundle identifiers, plugins — and this derives the three fields that must not be
 * duplicated anywhere: the store version and the two build numbers.
 *
 * Expo reads `app.json` first and hands it in as `config`, so this is a narrow override
 * rather than a second copy of the manifest. The version comes from this app's
 * `package.json`, which `scripts/set-version.mjs` writes along with every other manifest
 * in the workspace; `pnpm test:versions` fails if `app.json` ever grows an `expo.version`
 * again, since that would quietly become a second source.
 *
 * Why it matters more here than elsewhere: `expo.version` is the **user-visible store
 * version string** on both platforms, and store versions are permanent and monotonic.
 * A bump that updated `package.json` but not `app.json` would ship the wrong number to
 * a store record that can never go backwards.
 */

/**
 * The store version, which is the repo version with any pre-release suffix removed.
 *
 * The repo runs on real semver — `0.1.0-alpha.1` — because that is what says "this is
 * not the 0.1.0 release yet" to everyone reading the tree, and what would be correct if
 * these packages were ever published. Neither store will take it: iOS
 * `CFBundleShortVersionString` and Android `versionName` are at most three
 * dot-separated non-negative integers, and a suffix is rejected at upload.
 *
 * So the suffix is a *repo-side* fact and gets stripped here rather than being kept out
 * of `package.json` in the first place. The alternative — carrying the store's numeric
 * string as the real version and tracking pre-release status somewhere else — is the
 * second source of truth this file exists to prevent.
 *
 * Note what this does **not** mean: shipping `0.1.0` to TestFlight is not releasing
 * 0.1.0. A TestFlight build is not public until an App Store version is submitted and
 * released, which is a separate deliberate act.
 */
function storeVersion(version: string): string {
  const [numeric] = version.split("-");
  if (!/^\d+\.\d+(\.\d+)?$/.test(numeric)) {
    throw new Error(
      `version "${version}" has no store-legal numeric core (need X.Y or X.Y.Z, got "${numeric}")`,
    );
  }
  return numeric;
}

/** Minutes since this instant are the build number; see {@link buildNumber}. */
const BUILD_EPOCH_MS = Date.UTC(2026, 0, 1);

/**
 * The build number: **minutes elapsed since 2026-01-01 UTC**.
 *
 * Build numbers are per-*upload*, not per-release — both stores require every upload to
 * carry a number higher than the last, and that ordering has to hold across builds of
 * the same version, which is why it cannot be derived from the version alone.
 *
 * A clock reading needs no stored counter, cannot collide, and cannot be forgotten
 * during a bump — the three ways a hand-maintained number fails. Minutes rather than a
 * timestamp because Android's `versionCode` is a signed 32-bit int capped at
 * 2_100_000_000: `YYMMDDHHmm` overflows it, while minutes-since-epoch stays six digits
 * for the next two centuries. iOS is looser but shares the number so the two stores
 * never disagree about which build is newer.
 *
 * The cost is that the number is not reproducible from a commit — set
 * `LEAPSAKE_BUILD_NUMBER` to pin one when rebuilding an artifact for a known upload.
 * The value is baked into the native projects by `expo prebuild`, so it is fixed at
 * prebuild time rather than at archive time.
 */
function buildNumber(): number {
  const pinned = process.env.LEAPSAKE_BUILD_NUMBER;
  if (pinned !== undefined) {
    if (!/^\d+$/.test(pinned)) {
      throw new Error(
        `LEAPSAKE_BUILD_NUMBER must be a positive integer, got "${pinned}"`,
      );
    }
    return Number(pinned);
  }
  return Math.floor((Date.now() - BUILD_EPOCH_MS) / 60_000);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const build = buildNumber();
  return {
    ...config,
    name: config.name ?? "Leapsake",
    slug: config.slug ?? "leapsake",
    version: storeVersion(pkg.version),
    ios: { ...config.ios, buildNumber: String(build) },
    android: { ...config.android, versionCode: build },
  };
};
