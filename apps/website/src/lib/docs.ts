import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Loader } from "astro/loaders";
import { parseFrontmatter } from "astro/markdown";

// Gathers every markdown file with a `slug` from the repository; see the
// README's _Documentation_.

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

/** Where docs are gathered and the manifest written: the repository, unless
 *  `LEAPSAKE_DOCS_ROOT` points tests at a scratch tree. */
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

      /** Each slug's file, so a second claim can name both. */
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

        // A file with a slug is held to the whole schema, and throws otherwise.
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

/** Writes the sorted manifest only when it changes, as a loader runs on every
 *  hot reload. */
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
