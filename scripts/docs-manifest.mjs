// Regenerates `apps/website/docs-manifest.json`, or with `--check` fails if it
// is stale. See `apps/website/README.md` → _Documentation_.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE = join(ROOT, "apps", "website");
const MANIFEST = join(WEBSITE, "docs-manifest.json");

const read = () => {
  try {
    return readFileSync(MANIFEST, "utf8");
  } catch {
    return undefined;
  }
};

/** Runs `astro sync`, whose content layer writes the manifest. */
function regenerate() {
  const { status, stderr } = spawnSync("pnpm", ["exec", "astro", "sync"], {
    cwd: WEBSITE,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (status !== 0) {
    console.error("✗ could not read the documentation set\n");
    console.error(stderr.trim());
    process.exit(1);
  }
}

const before = read();
regenerate();
const after = read();

if (process.argv[2] !== "--check") {
  const count = Object.keys(JSON.parse(after ?? "{}")).length;
  console.log(
    `✓ docs-manifest.json regenerated — ${count} published document(s)`,
  );
  process.exit(0);
}

if (before === after) {
  const count = Object.keys(JSON.parse(after ?? "{}")).length;
  console.log(
    `✓ docs-manifest.json is current — ${count} published document(s)`,
  );
  process.exit(0);
}

// A check reports and leaves the tree as it found it.
if (before !== undefined) writeFileSync(MANIFEST, before);

const slugs = (json) => new Set(Object.keys(JSON.parse(json ?? "{}")));
const was = slugs(before);
const now = slugs(after);

console.error("✗ docs-manifest.json is stale\n");
for (const slug of now) if (!was.has(slug)) console.error(`  + ${slug}`);
for (const slug of was) if (!now.has(slug)) console.error(`  - ${slug}`);
console.error(
  "\nEach line is a public URL appearing or disappearing. If that is intended, run:" +
    "\n  node scripts/docs-manifest.mjs   (then commit the manifest)",
);
process.exit(1);
