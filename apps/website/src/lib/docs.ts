import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Loader } from "astro/loaders";
import { parseFrontmatter } from "astro/markdown";

/**
 * Consumer-facing documentation, gathered from wherever in the repository it lives.
 *
 * **A `slug` in the frontmatter is what publishes a file.** Nothing about a file's
 * location makes it a doc, so a guide can sit beside the code it describes — which
 * is the arrangement the rest of the repo already uses for its stable "why"
 * (`plans/README.md`). A markdown file with no `slug` is technical documentation and
 * is passed over; there is no second flag to forget, because the slug is the URL and
 * a doc without one has nowhere to be published to.
 *
 * The cost of dropping the location convention is that you can no longer see the
 * published set from a file tree. `docs-manifest.json` buys that back, and more: it
 * is committed, so a changed *public URL* shows up in a pull request diff rather than
 * only in a deploy.
 */

const WEBSITE = resolve(fileURLToPath(import.meta.url), "../../..");

/** Where no documentation lives, and walking is only expensive. */
const SKIP = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  ".git",
  ".astro",
]);

/**
 * The tree to gather docs from, and where the manifest lands.
 *
 * Normally the repository. `LEAPSAKE_DOCS_ROOT` redirects both at a scratch
 * directory, which is the seam `test/docs.test.ts` uses to exercise the collision
 * and schema failures against real files without putting fixtures inside the repo —
 * where a crashed test could leave one behind and publish it.
 */
function roots() {
  const override = process.env.LEAPSAKE_DOCS_ROOT;
  const root = override ?? resolve(WEBSITE, "../..");
  return { root, manifest: join(override ?? WEBSITE, "docs-manifest.json") };
}

async function* markdownFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) yield* markdownFiles(path);
    } else if (entry.name.endsWith(".md")) {
      yield path;
    }
  }
}

export function docsLoader(): Loader {
  return {
    name: "leapsake:docs",

    async load({ store, parseData, renderMarkdown, generateDigest }) {
      store.clear();
      const { root, manifest } = roots();

      /** slug → the file that claimed it, so a second claim can name both. */
      const sources = new Map<string, string>();

      for await (const file of markdownFiles(root)) {
        const raw = await readFile(file, "utf8");
        const { frontmatter, content } = parseFrontmatter(raw);
        const slug: unknown = frontmatter.slug;

        // No slug: technical documentation. Not an error, and not a doc.
        if (slug === undefined) continue;

        const source = relative(root, file);
        if (typeof slug !== "string") {
          throw new Error(
            `${source}: \`slug\` must be a string, got ${typeof slug}`,
          );
        }

        const claimed = sources.get(slug);
        if (claimed !== undefined) {
          throw new Error(
            `Two documents claim the slug "${slug}":\n  ${claimed}\n  ${source}\n` +
              "A slug is a public URL, so it can only belong to one of them.",
          );
        }
        sources.set(slug, source);

        // Throws on anything the collection schema rejects — an unknown section, a
        // malformed slug, a missing title. A file that has opted in by carrying a
        // slug is held to the whole shape.
        const data = await parseData({
          id: slug,
          data: frontmatter,
          filePath: file,
        });

        store.set({
          id: slug,
          data,
          body: content,
          filePath: source,
          digest: generateDigest(raw),
          rendered: await renderMarkdown(content, {
            fileURL: pathToFileURL(file),
          }),
        });
      }

      await writeManifest(manifest, sources);
    },
  };
}

/**
 * Write the manifest, but only when it would change — a loader runs on every hot
 * reload in dev, and rewriting an identical file each time would churn its mtime for
 * nothing.
 *
 * Sorted, so the committed file has a stable order and its diff shows only real
 * changes to the published set.
 */
async function writeManifest(path: string, sources: Map<string, string>) {
  const next =
    JSON.stringify(
      Object.fromEntries([...sources].sort(([a], [b]) => a.localeCompare(b))),
      null,
      2,
    ) + "\n";

  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current !== next) await writeFile(path, next);
}
