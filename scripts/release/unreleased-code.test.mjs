import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  BUNDLE_IN,
  UNRELEASED_MARKERS,
  assertNoUnreleasedCode,
  unreleasedCodeIn,
} from "./unreleased-code.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const TEST_ONLY_MARKER = "leapsake-test-only-code";
const SYNC_PREVIEW_MARKER = "leapsake-sync-preview-code";

/** Where the app declares each marker its unreleased modules carry. */
const MARKER_SOURCES = {
  [TEST_ONLY_MARKER]: "apps/mobile/test/test-only.ts",
  [SYNC_PREVIEW_MARKER]: "apps/mobile/sync/preview.ts",
};

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A zip holding `contents` at `member`, the way a store archive holds its bundle. */
function archiveWith(member, contents) {
  const dir = mkdtempSync(join(tmpdir(), "unreleased-code-"));
  dirs.push(dir);
  const file = join(dir, "tree", member);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  const archive = join(dir, "store.zip");
  execFileSync("zip", ["-qr", archive, "."], { cwd: join(dir, "tree") });
  return archive;
}

describe("the unreleased-code markers", () => {
  it("are exactly the ones the app declares", () => {
    expect(Object.keys(UNRELEASED_MARKERS).sort()).toEqual(
      Object.keys(MARKER_SOURCES).sort(),
    );
  });

  it.each(Object.entries(MARKER_SOURCES))(
    "%s is the string %s declares",
    (marker, path) => {
      expect(readFileSync(join(ROOT, path), "utf8")).toContain(`"${marker}"`);
    },
  );

  it("are found in a bundle's bytes wherever they sit", () => {
    expect(
      unreleasedCodeIn(Buffer.from(`\0\x01${TEST_ONLY_MARKER}\0`)),
    ).toEqual([UNRELEASED_MARKERS[TEST_ONLY_MARKER]]);
    expect(unreleasedCodeIn(Buffer.from("leapsake-test-only"))).toEqual([]);
  });
});

describe("assertNoUnreleasedCode", () => {
  it("passes an .ipa whose bundle has no unreleased code", () => {
    const ipa = archiveWith("Payload/Leapsake.app/main.jsbundle", "store code");
    expect(() => assertNoUnreleasedCode(ipa, BUNDLE_IN.ipa)).not.toThrow();
  });

  it("refuses an .ipa whose bundle has test-only code", () => {
    const ipa = archiveWith(
      "Payload/Leapsake.app/main.jsbundle",
      `store code ${TEST_ONLY_MARKER}`,
    );
    expect(() => assertNoUnreleasedCode(ipa, BUNDLE_IN.ipa)).toThrow(
      /test-only screens/,
    );
  });

  it("refuses an .aab whose bundle has test-only code", () => {
    const aab = archiveWith(
      "base/assets/index.android.bundle",
      TEST_ONLY_MARKER,
    );
    expect(() => assertNoUnreleasedCode(aab, BUNDLE_IN.aab)).toThrow(
      /test-only screens/,
    );
  });

  it("refuses an .ipa whose bundle has the sync preview", () => {
    const ipa = archiveWith(
      "Payload/Leapsake.app/main.jsbundle",
      `store code ${SYNC_PREVIEW_MARKER}`,
    );
    expect(() => assertNoUnreleasedCode(ipa, BUNDLE_IN.ipa)).toThrow(
      /the sync preview \(it was built with EXPO_PUBLIC_SYNC set\)/,
    );
  });

  it("names everything a bundle carries, not just the first", () => {
    const aab = archiveWith(
      "base/assets/index.android.bundle",
      `${SYNC_PREVIEW_MARKER} ${TEST_ONLY_MARKER}`,
    );
    expect(() => assertNoUnreleasedCode(aab, BUNDLE_IN.aab)).toThrow(
      /test-only screens .* and the sync preview/,
    );
  });

  it("refuses an archive it cannot find a bundle in, rather than passing it", () => {
    const aab = archiveWith("base/assets/other.bundle", "store code");
    expect(() => assertNoUnreleasedCode(aab, BUNDLE_IN.aab)).toThrow(
      /no JS bundle/,
    );
  });

  it("refuses an empty bundle", () => {
    const aab = archiveWith("base/assets/index.android.bundle", "");
    expect(() => assertNoUnreleasedCode(aab, BUNDLE_IN.aab)).toThrow(
      /empty JS bundle/,
    );
  });
});
