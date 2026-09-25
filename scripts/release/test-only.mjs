// A store build must carry none of the test-only screens: `dev-clear-dbkey` deletes the
// database key, and any app or website can open it by deep link.
import { execFileSync } from "node:child_process";

/** What every test-only screen carries; the same string as `apps/mobile/test/test-only.ts`. */
export const TEST_ONLY_MARKER = "leapsake-test-only-code";

/** Where each store archive keeps its JS bundle, as an `unzip` member pattern. */
export const BUNDLE_IN = {
  ipa: "Payload/*.app/main.jsbundle",
  aab: "base/assets/index.android.bundle",
};

export const containsTestOnlyCode = (bundle) =>
  bundle.includes(TEST_ONLY_MARKER);

/** Throw unless `archive` holds a JS bundle at `member` with no test-only code in it. */
export function assertNoTestOnlyCode(archive, member) {
  let bundle;
  try {
    bundle = execFileSync("unzip", ["-p", archive, member], {
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error(`${archive} has no JS bundle at ${member}`);
  }
  if (bundle.length === 0) {
    throw new Error(`${archive} has an empty JS bundle at ${member}`);
  }
  if (containsTestOnlyCode(bundle)) {
    throw new Error(
      `${archive} contains test-only screens (it was built with EXPO_PUBLIC_E2E set) — ` +
        "a store build must never carry them",
    );
  }
}
