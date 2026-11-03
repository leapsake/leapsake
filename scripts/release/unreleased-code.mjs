// A store build carries no unreleased code: `dev-clear-dbkey` deletes the
// database key by deep link, and a preview is unfinished work.
import { execFileSync } from "node:child_process";

/** Each marker unreleased app code carries, and what it means in a bundle. */
export const UNRELEASED_MARKERS = {
  "leapsake-test-only-code":
    "test-only screens (it was built with EXPO_PUBLIC_E2E set)",
  "leapsake-sync-preview-code":
    "the sync preview (it was built with EXPO_PUBLIC_SYNC set)",
};

/** Each store archive's JS bundle, as an `unzip` member pattern. */
export const BUNDLE_IN = {
  ipa: "Payload/*.app/main.jsbundle",
  aab: "base/assets/index.android.bundle",
};

/** What unreleased code `bundle` carries, per {@link UNRELEASED_MARKERS}. */
export const unreleasedCodeIn = (bundle) =>
  Object.entries(UNRELEASED_MARKERS)
    .filter(([marker]) => bundle.includes(marker))
    .map(([, what]) => what);

/** Throws unless `archive` has a bundle at `member` with no unreleased code. */
export function assertNoUnreleasedCode(archive, member) {
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
  const found = unreleasedCodeIn(bundle);
  if (found.length > 0) {
    throw new Error(
      `${archive} contains ${found.join(" and ")} — ` +
        "a store build must never carry them",
    );
  }
}
