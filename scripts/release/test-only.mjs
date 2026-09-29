// A store build carries no test-only screen: `dev-clear-dbkey` deletes the
// database key, and any app or site could open it by deep link.
import { execFileSync } from "node:child_process";

/** The marker every test-only screen carries, as `test/test-only.ts` has it. */
export const TEST_ONLY_MARKER = "leapsake-test-only-code";

/** Each store archive's JS bundle, as an `unzip` member pattern. */
export const BUNDLE_IN = {
  ipa: "Payload/*.app/main.jsbundle",
  aab: "base/assets/index.android.bundle",
};

export const containsTestOnlyCode = (bundle) =>
  bundle.includes(TEST_ONLY_MARKER);

/** Throws unless `archive` has a bundle at `member` with no test-only code. */
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
