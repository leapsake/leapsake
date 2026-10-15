// Builds the website, then fails unless leapsake.com serves every built file
// to a browser byte-for-byte. See `apps/website/README.md` → _Deployment_.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE = join(ROOT, "apps", "website");
const DIST = join(WEBSITE, "dist");
const ORIGIN = "https://leapsake.com";

// Cloudflare reads `_headers` itself and never serves it.
const NOT_SERVED = new Set(["_headers"]);

// The edge injected its beacon only into requests shaped like a navigation.
const PAGE_HEADERS = {
  Accept: "text/html,application/xhtml+xml",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
};

function build() {
  const { status, stderr } = spawnSync("pnpm", ["exec", "astro", "build"], {
    cwd: WEBSITE,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (status !== 0) {
    console.error("✗ the website did not build\n");
    console.error(stderr.trim());
    process.exit(1);
  }
}

function* builtFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* builtFiles(path);
    else yield relative(DIST, path).split(sep).join("/");
  }
}

/** The URL a built file is served at: `privacy/index.html` → `/privacy/`. */
const urlPathOf = (file) =>
  "/" +
  (file.endsWith("index.html") ? file.slice(0, -"index.html".length) : file);

/** Where two buffers first differ, with a little of each side around it. */
function firstDifference(built, live) {
  let i = 0;
  while (i < built.length && i < live.length && built[i] === live[i]) i++;
  const around = (buf) =>
    JSON.stringify(buf.subarray(Math.max(0, i - 40), i + 80).toString("utf8"));
  return { offset: i, built: around(built), live: around(live) };
}

async function check(file) {
  const path = urlPathOf(file);
  const built = readFileSync(join(DIST, file));
  let response;
  try {
    response = await fetch(ORIGIN + path, {
      headers: file.endsWith(".html") ? PAGE_HEADERS : {},
      redirect: "manual",
    });
  } catch (error) {
    return { path, problem: `could not be fetched: ${error.cause ?? error}` };
  }
  if (response.status !== 200)
    return { path, problem: `answered ${response.status}, not 200` };
  const live = Buffer.from(await response.arrayBuffer());
  if (built.equals(live)) return { path };
  const diff = firstDifference(built, live);
  return {
    path,
    problem:
      `differs from dist/${file} at byte ${diff.offset} ` +
      `(built ${built.length} bytes, live ${live.length})\n` +
      `      built: ${diff.built}\n` +
      `      live:  ${diff.live}`,
  };
}

build();
const files = [...builtFiles(DIST)].filter((f) => !NOT_SERVED.has(f)).sort();
const results = await Promise.all(files.map(check));
const failures = results.filter((r) => r.problem);

for (const { path, problem } of results)
  console.log(problem ? `✗ ${path} ${problem}` : `✓ ${path}`);

if (failures.length === 0) {
  console.log(`\n✓ ${ORIGIN} serves all ${files.length} built files unchanged`);
  process.exit(0);
}

console.error(
  `\n✗ ${failures.length} of ${files.length} files differ from what was built.` +
    "\n  An edge feature rewriting responses is the usual cause; so is a site change" +
    "\n  not yet deployed, since the live site is built from the remote's main.",
);
process.exit(1);
