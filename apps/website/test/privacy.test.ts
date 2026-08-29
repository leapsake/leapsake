import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { beforeAll, describe, expect, it } from "vitest";

/**
 * The privacy policy is the one page with a consequence attached to being wrong: it
 * is the URL the App Store listing points at, and it is a legal statement about a
 * product whose whole claim is that it collects nothing.
 *
 * So this asserts the built artifact rather than the source. `PRIVACY.md` is
 * rendered from the repository root through a pipeline with a comment-stripping
 * plugin in it (`src/lib/strip-comments.mjs`), and the thing worth proving is what
 * a reader actually receives.
 */
const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));

let html: string;

beforeAll(async () => {
  await promisify(execFile)("pnpm", ["exec", "astro", "build"], {
    cwd: WEBSITE,
  });
  html = await readFile(join(WEBSITE, "dist/privacy/index.html"), "utf8");
}, 120_000);

describe("the published privacy policy", () => {
  it("carries the policy itself", () => {
    expect(html).toContain(
      "We do not collect, store, or transmit any of your information.",
    );
    expect(html).toContain("hello@leapsake.com");
    expect(html).toContain("Leapsake is published by Joshua Smith.");
  });

  it("does not leak the internal notes in PRIVACY.md's header comment", () => {
    // The source file opens with an HTML comment recording how each claim was
    // verified and pointing at `plans/v0-1.md`. Astro renders raw HTML in markdown
    // straight through, so this is a real leak that has been observed, not a
    // hypothetical one — the comment shipped before the plugin existed.
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("plans/");
    expect(html).not.toContain("App Store Connect requires");
  });

  it("ships no JavaScript", () => {
    // Not a performance preference. A policy page asserting that the product has no
    // analytics and no trackers should be able to say the same of itself, and the
    // cheapest way to keep that true is for a script tag to fail a test.
    expect(html).not.toContain("<script");
  });
});
