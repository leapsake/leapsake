// The app-icon generator — one vector source, every raster an app store asks for.
//
// `assets/icon/leapsake.svg` is the only hand-edited icon file in the repo. Everything
// below is derived from it and **committed**, because the things that consume these PNGs
// (`expo prebuild`, EAS, electron-builder) run on machines that have no SVG rasterizer and
// no business acquiring one. Generated-and-committed is the same bargain `pnpm build`
// makes; the part that needs guarding is that the two halves stay in agreement, which is
// what `--check` is for.
//
// Usage:
//   node scripts/icons.mjs           re-render every output and rewrite the manifest
//   node scripts/icons.mjs --check   verify the committed PNGs match the source (no render)
//
// `--check` is deliberately a *hash* comparison against `assets/icon/generated.json`
// rather than a re-render. Re-rendering would make the check need librsvg — turning a
// cheap static tier into one that is BLOCKED on most machines — and would also fail on
// harmless byte differences between librsvg versions. Comparing hashes answers the only
// question that matters: did someone change the SVG, or hand-edit a PNG, without
// regenerating? Exit code 1 if so.
//
// ## Why two system tools, and not a dependency
//
// Rendering needs `rsvg-convert` (librsvg) and `magick` (ImageMagick). Neither is a
// package dependency on purpose: this script runs *only* when the artwork changes, and the
// alternative — `sharp`, which bundles both — would put a second native binary into every
// install of a repo that already has a hard-won fight with one (AGENTS.md → “The native
// SQLite ABI, and how it bites”). A tool you install once with Homebrew and never think
// about again is the cheaper side of that trade. `--check` needs neither.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "assets/icon/leapsake.svg";
const MANIFEST = "assets/icon/generated.json";

/**
 * The colour behind the artwork, which is `tokens.surface` from `@leapsake/ui` — the same
 * warm cream the app itself is painted on.
 *
 * It is duplicated here rather than imported because this script must run before anything
 * is built and outside the TypeScript project graph. `--check` does not catch a drift
 * between the two; if the surface token ever changes, the icon is a deliberate follow-up
 * rather than an automatic one, since an app icon changing colour is a user-visible event
 * and store listings carry screenshots of it.
 */
const BACKGROUND = "#fbf7f0";

/**
 * How much of each canvas the artwork spans, as a fraction of the canvas edge.
 *
 * These are the whole design of this file, so they are stated as measurements rather than
 * taste:
 *
 * - **0.72 (`icon.png`)** — iOS and Android-legacy both mask to a rounded square and add
 *   their own optical padding, so the glyph wants to sit inside the corner radius without
 *   looking lost in the middle. 0.72 puts the frog's bounding box at 737px of 1024, whose
 *   corners fall well inside iOS's ~229px corner radius.
 *
 * - **0.49 (`adaptive-icon.png`)** — Android adaptive icons are 108dp with only the
 *   central **66dp** guaranteed unmasked; a launcher may mask anything outside it, and
 *   Pixel's circle does. The naive reading of “66 of 108” is 0.611, but that describes a
 *   *circle*, not a square: this frog is nearly as wide as it is tall, so at 0.611 its ear
 *   tips sit 0.372 of the canvas from centre and a circular mask slices them off. Fitting
 *   the artwork's true corner radius inside the 66dp circle's 0.3055 gives 0.49. The
 *   `contentRadius` recorded in the manifest is that measurement, so this number can be
 *   re-derived rather than re-guessed if the artwork ever changes.
 */
const FRACTIONS = { masked: 0.72, adaptive: 0.49 };

/**
 * What gets written, and who reads it.
 *
 * `background: undefined` means a transparent canvas. That is not a style choice in either
 * direction — iOS **rejects** an app icon with an alpha channel, and an Android adaptive
 * foreground **must** have one so the background layer shows through behind it. The same
 * artwork therefore has to be rendered twice.
 */
const OUTPUTS = [
  {
    path: "apps/mobile/assets/icon.png",
    size: 1024,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "expo.icon — iOS AppIcon at every size, and the Android legacy icon",
  },
  {
    path: "apps/mobile/assets/adaptive-icon.png",
    size: 1024,
    fraction: FRACTIONS.adaptive,
    background: undefined,
    note: "expo.android.adaptiveIcon.foregroundImage — backgroundColor supplies the layer behind it",
  },
  {
    path: "apps/desktop/resources/icon.png",
    size: 1024,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "the Electron window icon, and the master electron-builder will slice when desktop packaging lands (plans/v0-2.md)",
  },
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const read = (relative) => readFileSync(join(ROOT, relative));

/** Every tool this script shells out to, checked together so one run reports both. */
function requireTools() {
  const missing = [];
  for (const [tool, args] of [
    ["rsvg-convert", ["--version"]],
    ["magick", ["-version"]],
  ]) {
    try {
      execFileSync(tool, args, { stdio: "ignore" });
    } catch {
      missing.push(tool);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `missing ${missing.join(" and ")} — install with \`brew install librsvg imagemagick\`.\n` +
        "Only regeneration needs them; `node scripts/icons.mjs --check` does not.",
    );
  }
}

/**
 * The artwork's drawn extent, in the source's own user units.
 *
 * Needed because an SVG's `viewBox` says where the canvas is, not where the ink is — this
 * one is 72×72 with the frog occupying an off-centre 48.5×49.2 of it. Centring on the
 * viewBox would inherit that offset into every output, so the ink is measured instead:
 * render once with a transparent background, and ask ImageMagick for the bounding box of
 * the non-transparent pixels (`%@`). Measuring beats parsing path geometry, and beats
 * hard-coding numbers that would silently stop being true the day the artwork changes.
 */
function measureContent(source) {
  const probe = 1024;
  const png = execFileSync(
    "rsvg-convert",
    ["-w", String(probe), "-h", String(probe), join(ROOT, source)],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const box = execFileSync("magick", ["identify", "-format", "%@", "png:-"], {
    input: png,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(box.trim());
  if (!match) {
    throw new Error(`could not read a content box from ImageMagick: "${box}"`);
  }
  const [, w, h, x, y] = match.map(Number);
  if (w === 0 || h === 0) {
    throw new Error(
      `${source} renders to nothing — is every element transparent?`,
    );
  }
  // Back into source user units, so the numbers stay meaningful next to the viewBox.
  const viewBox = /viewBox="([\d.\s-]+)"/.exec(
    readFileSync(join(ROOT, source), "utf8"),
  );
  const units = viewBox ? Number(viewBox[1].trim().split(/\s+/)[2]) : probe;
  const scale = units / probe;
  return {
    x: x * scale,
    y: y * scale,
    width: w * scale,
    height: h * scale,
    /** Half-diagonal of the content box, as a fraction of its own longest edge. */
    contentRadius: Math.hypot(w, h) / 2 / Math.max(w, h),
  };
}

/**
 * A wrapper SVG that places the source's ink into a square canvas.
 *
 * The placement is done with a **nested `<svg>`** rather than a `transform`: giving the
 * inner element the measured content box as its `viewBox` and the destination rect as its
 * geometry makes `preserveAspectRatio="xMidYMid meet"` do the fit and the centring, which
 * is exactly the arithmetic that is easy to get subtly wrong by hand. Stroke widths scale
 * with it, which is what a line-art glyph wants.
 */
function wrap({ inner, box, size, fraction, background }) {
  const inset = ((1 - fraction) / 2) * size;
  const edge = size - inset * 2;
  const rect = background
    ? `<rect width="${size}" height="${size}" fill="${background}"/>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    rect +
    `<svg x="${inset}" y="${inset}" width="${edge}" height="${edge}"` +
    ` viewBox="${box.x} ${box.y} ${box.width} ${box.height}" preserveAspectRatio="xMidYMid meet">` +
    inner +
    "</svg></svg>"
  );
}

/**
 * Guards the one property of these files that a store rejects an upload over.
 *
 * **An iOS app icon may not have an alpha channel** — App Store Connect refuses the
 * binary, at upload, after everything else has already succeeded. An Android adaptive
 * foreground has the opposite requirement: without alpha it hides its own background
 * layer. librsvg happens to drop the channel when a canvas is fully covered and keep it
 * when it is not, which is exactly right, but it is *librsvg's* behaviour rather than
 * anything this script asked for. Asserting it here turns a future rasterizer change into
 * a failed `pnpm icons` instead of a failed release.
 */
function assertAlpha(png, { path, background }) {
  // `%[channels]` reads "srgba 4.0" / "srgb 3.0" — the colourspace token carries the
  // alpha, and the channel count trailing it is why this is parsed rather than suffixed.
  const channels = execFileSync(
    "magick",
    ["identify", "-format", "%[channels]", "png:-"],
    { input: png, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const [colorspace] = channels.trim().split(/\s+/);
  const hasAlpha = colorspace.endsWith("a");
  if (background && hasAlpha) {
    throw new Error(
      `${path} carries an alpha channel; iOS rejects an app icon that does. ` +
        "The rasterizer no longer drops it for an opaque canvas — flatten before writing.",
    );
  }
  if (!background && !hasAlpha) {
    throw new Error(
      `${path} lost its alpha channel; an Android adaptive foreground needs one, ` +
        "or it paints over the background layer it is meant to sit on.",
    );
  }
}

/** The source's drawable children, with its own root `<svg>` element peeled off. */
function contentsOf(source) {
  const svg = readFileSync(join(ROOT, source), "utf8");
  const opened = svg.indexOf(">", svg.indexOf("<svg"));
  const closed = svg.lastIndexOf("</svg>");
  if (opened === -1 || closed === -1) {
    throw new Error(`${source} does not look like an SVG document`);
  }
  return svg.slice(opened + 1, closed);
}

function generate() {
  requireTools();
  const box = measureContent(SOURCE);
  const inner = contentsOf(SOURCE);

  const outputs = OUTPUTS.map((output) => {
    const svg = wrap({ inner, box, ...output });
    const png = execFileSync(
      "rsvg-convert",
      ["-w", String(output.size), "-h", String(output.size)],
      { input: svg, maxBuffer: 64 * 1024 * 1024 },
    );
    assertAlpha(png, output);
    const absolute = join(ROOT, output.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, png);
    console.log(
      `  ${output.path}  ${output.size}²  ${output.background ?? "transparent"}  ${png.length.toLocaleString()} bytes`,
    );
    return {
      path: output.path,
      size: output.size,
      fraction: output.fraction,
      background: output.background ?? null,
      note: output.note,
      sha256: sha256(png),
    };
  });

  const manifest = {
    // Regenerate with `pnpm icons`; `pnpm test:icons` fails if this drifts from the files.
    source: SOURCE,
    sourceSha256: sha256(read(SOURCE)),
    contentBox: box,
    outputs,
  };
  writeFileSync(join(ROOT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${outputs.length} icons written from ${SOURCE}`);
}

function check() {
  let manifest;
  try {
    manifest = JSON.parse(read(MANIFEST).toString());
  } catch {
    throw new Error(
      `${MANIFEST} is missing or unreadable — run \`pnpm icons\``,
    );
  }

  const problems = [];
  if (sha256(read(manifest.source)) !== manifest.sourceSha256) {
    problems.push(
      `${manifest.source} has changed since the icons were generated — run \`pnpm icons\``,
    );
  }
  for (const output of manifest.outputs) {
    let actual;
    try {
      actual = sha256(read(output.path));
    } catch {
      problems.push(`${output.path} is missing — run \`pnpm icons\``);
      continue;
    }
    if (actual !== output.sha256) {
      problems.push(
        `${output.path} does not match the source it was generated from — run \`pnpm icons\` rather than editing it`,
      );
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `icons agree with ${manifest.source} (${manifest.outputs.length} outputs)`,
  );
}

try {
  if (process.argv.includes("--check")) check();
  else generate();
} catch (error) {
  console.error(`icons: ${error.message}`);
  process.exitCode = 1;
}
