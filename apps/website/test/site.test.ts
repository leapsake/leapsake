import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The built site, asserted as a reader receives it.
 *
 * **One file on purpose.** Every test here drives a real `astro build` against the
 * same project directory, and two of those running at once clobber each other's
 * `dist/` and content cache. Vitest parallelises across files but runs tests within
 * one file in order, so sharing a file is what keeps these deterministic.
 */
const WEBSITE = dirname(dirname(fileURLToPath(import.meta.url)));
const execFileAsync = promisify(execFile);

describe("the published privacy policy", () => {
  /**
   * The one page with a consequence attached to being wrong: it is the URL the App
   * Store listing points at, and it is a legal statement about a product whose whole
   * claim is that it collects nothing.
   */
  let html: string;

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "astro", "build"], { cwd: WEBSITE });
    html = await readFile(join(WEBSITE, "dist/privacy/index.html"), "utf8");
  }, 120_000);

  it("carries the policy itself", () => {
    expect(html).toContain(
      "We do not collect, store, or transmit any of your information.",
    );
    expect(html).toContain("hello@leapsake.com");
    expect(html).toContain("Leapsake is published by Joshua Smith.");
  });

  it("carries the site header, since it comes from the shared layout", () => {
    // Asserted on this page rather than the home page precisely because it is not
    // the home page: the header lives in `Base.astro`, so proving it here proves it
    // is global rather than something the landing page happens to render.
    expect(html).toContain('<header><a href="/">Leapsake</a></header>');
  });

  it("does not leak the internal notes in PRIVACY.md's header comment", () => {
    // The source file opens with an HTML comment recording how each claim was
    // verified and pointing at `plans/shipping.md`. Astro renders raw HTML in markdown
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

/**
 * The docs model, exercised against real files.
 *
 * A `slug` in a markdown file's frontmatter is what publishes it, from anywhere in
 * the repository — so the rules that keep that safe (one claim per slug, a closed set
 * of sections, a required title) are the whole of the design. Today the collection is
 * empty, so nothing else in the repo would notice if any of them stopped working.
 *
 * `LEAPSAKE_DOCS_ROOT` points the loader at a scratch directory. Fixtures inside the
 * repo would be found by an ordinary build — and a crashed test could leave one
 * behind and publish it.
 */
describe("the docs model", () => {
  let root: string;

  const build = () =>
    execFileAsync("pnpm", ["exec", "astro", "build"], {
      cwd: WEBSITE,
      env: { ...process.env, LEAPSAKE_DOCS_ROOT: root },
    });

  const write = async (path: string, body: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), body);
  };

  const doc = (front: string, body = "Drag a vCard onto the window.") =>
    `---\n${front}\n---\n\n${body}\n`;

  const manifest = async () =>
    JSON.parse(await readFile(join(root, "docs-manifest.json"), "utf8"));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "leapsake-docs-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("publishes a file at its slug, wherever in the tree it lives", async () => {
    await write(
      "packages/vcard/anywhere-at-all.md",
      doc('slug: contacts/importing\ntitle: Importing contacts\nsince: "0.4"'),
    );

    await build();

    const page = await readFile(
      join(WEBSITE, "dist/docs/next/contacts/importing/index.html"),
      "utf8",
    );
    expect(page).toContain("Importing contacts");
    expect(page).toContain("Drag a vCard onto the window.");
    // Unreleased docs describe a build nobody can install yet.
    expect(page).toContain('name="robots" content="noindex"');
  });

  it("records every published slug against its source file", async () => {
    await write(
      "packages/reminders/notes.md",
      doc('slug: reminders/birthdays\ntitle: Birthday reminders\nsince: "0.4"'),
    );

    await build();

    expect(await manifest()).toEqual({
      "reminders/birthdays": "packages/reminders/notes.md",
    });
  });

  it("passes over a file with no slug rather than failing on it", async () => {
    await write(
      "packages/core/README.md",
      "# Why this package is shaped this way\n",
    );
    await write(
      "packages/core/guide.md",
      doc('slug: getting-started/welcome\ntitle: Welcome\nsince: "0.1"'),
    );

    await build();

    expect(Object.keys(await manifest())).toEqual(["getting-started/welcome"]);
  });

  it("refuses two documents claiming one slug, naming both files", async () => {
    const frontmatter = 'slug: gifts/ideas\ntitle: Gift ideas\nsince: "0.4"';
    await write("packages/gifts/a.md", doc(frontmatter));
    await write("packages/ui/b.md", doc(frontmatter));

    // A slug is a public URL: silently letting one file win would mean the page a
    // link points at depends on directory-walk order.
    await expect(build()).rejects.toThrow(/packages\/gifts\/a\.md/);
    await expect(build()).rejects.toThrow(/packages\/ui\/b\.md/);
  });

  it("refuses a section outside the closed set", async () => {
    await write(
      "packages/core/x.md",
      doc('slug: invented/thing\ntitle: A thing\nsince: "0.4"'),
    );

    // The section enum is also the reserved-word check: this is what stops a slug
    // beginning `next` or `v0.4` and shadowing a version segment in the URL.
    await expect(build()).rejects.toThrow(/is not a section/);
  });

  it("refuses a document that opted in but is missing a title", async () => {
    await write("packages/core/y.md", doc('slug: sync/pairing\nsince: "0.4"'));

    await expect(build()).rejects.toThrow(/title/);
  });
});
