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
  TEST_ONLY_MARKER,
  assertNoTestOnlyCode,
  containsTestOnlyCode,
} from "./test-only.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A zip holding `contents` at `member`, the way a store archive holds its bundle. */
function archiveWith(member, contents) {
  const dir = mkdtempSync(join(tmpdir(), "test-only-"));
  dirs.push(dir);
  const file = join(dir, "tree", member);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
  const archive = join(dir, "store.zip");
  execFileSync("zip", ["-qr", archive, "."], { cwd: join(dir, "tree") });
  return archive;
}

describe("the test-only marker", () => {
  it("is the string the app's test-only screens carry", () => {
    const source = readFileSync(
      join(ROOT, "apps/mobile/test/test-only.ts"),
      "utf8",
    );
    expect(source).toContain(`"${TEST_ONLY_MARKER}"`);
  });

  it("is found in a bundle's bytes wherever it sits", () => {
    expect(
      containsTestOnlyCode(Buffer.from(`\0\x01${TEST_ONLY_MARKER}\0`)),
    ).toBe(true);
    expect(containsTestOnlyCode(Buffer.from("leapsake-test-only"))).toBe(false);
  });
});

describe("assertNoTestOnlyCode", () => {
  it("passes an .ipa whose bundle has no test-only code", () => {
    const ipa = archiveWith("Payload/Leapsake.app/main.jsbundle", "store code");
    expect(() => assertNoTestOnlyCode(ipa, BUNDLE_IN.ipa)).not.toThrow();
  });

  it("refuses an .ipa whose bundle has test-only code", () => {
    const ipa = archiveWith(
      "Payload/Leapsake.app/main.jsbundle",
      `store code ${TEST_ONLY_MARKER}`,
    );
    expect(() => assertNoTestOnlyCode(ipa, BUNDLE_IN.ipa)).toThrow(
      /test-only screens/,
    );
  });

  it("refuses an .aab whose bundle has test-only code", () => {
    const aab = archiveWith(
      "base/assets/index.android.bundle",
      TEST_ONLY_MARKER,
    );
    expect(() => assertNoTestOnlyCode(aab, BUNDLE_IN.aab)).toThrow(
      /test-only screens/,
    );
  });

  it("refuses an archive it cannot find a bundle in, rather than passing it", () => {
    const aab = archiveWith("base/assets/other.bundle", "store code");
    expect(() => assertNoTestOnlyCode(aab, BUNDLE_IN.aab)).toThrow(
      /no JS bundle/,
    );
  });

  it("refuses an empty bundle", () => {
    const aab = archiveWith("base/assets/index.android.bundle", "");
    expect(() => assertNoTestOnlyCode(aab, BUNDLE_IN.aab)).toThrow(
      /empty JS bundle/,
    );
  });
});
