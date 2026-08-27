// The app-icon generator — two vector sources, every raster an app store asks for.
//
// `assets/icon/` holds the only hand-edited icon files in the repo:
//
//   logo_color.svg   the frog as it is seen — launcher and dock icons
//   logo_bw.svg      the same frog as line art only, for surfaces that get one colour
//
// Everything else is derived from them and **committed**, because the things that consume
// these PNGs (`expo prebuild`, EAS, electron-builder) run on machines that have no SVG
// rasterizer and no business acquiring one. Generated-and-committed is the same bargain
// `pnpm build` makes; the part that needs guarding is that the two halves stay in
// agreement, which is what `--check` is for.
//
// Usage:
//   node scripts/icons.mjs           re-render every output and rewrite the manifest
//   node scripts/icons.mjs --check   verify the committed PNGs match the sources (no render)
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
const MANIFEST = "assets/icon/generated.json";

/**
 * The hand-edited artwork. `color` is the frog; `mono` is the same drawing with its fill
 * dropped, which is what a surface that renders one colour has to be given.
 */
const SOURCES = {
  color: "assets/icon/logo_color.svg",
  mono: "assets/icon/logo_bw.svg",
};

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
 *
 * - **0.85 (`notification-icon.png`)** — Android's status bar draws the small icon into a
 *   24dp box and expects roughly 2dp of breathing room inside it, which is where this
 *   comes from. There is no mask to dodge here, so it is the loosest of the three.
 *
 * - **0.96 (`logo.png`)** — nothing masks or pads a mark drawn inside the app, so this is
 *   as tight as the artwork goes. Not 1.0 only because the measured box is the *rendered*
 *   ink including its antialiased edge, and filling the canvas exactly would put that soft
 *   edge on the boundary where a later resize can clip it.
 */
const FRACTIONS = {
  masked: 0.72,
  adaptive: 0.49,
  notification: 0.85,
  bare: 0.96,
};

/**
 * What gets written, and who reads it.
 *
 * `background: undefined` means a transparent canvas. That is not a style choice in either
 * direction — iOS **rejects** an app icon with an alpha channel, and both the Android
 * adaptive foreground and the notification icon **must** have one, the first so the
 * background layer shows through and the second because Android reads nothing else. The
 * same artwork therefore has to be rendered more than once.
 */
const OUTPUTS = [
  {
    path: "apps/mobile/assets/icon.png",
    source: SOURCES.color,
    size: 1024,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "expo.icon — iOS AppIcon at every size, and the Android legacy icon",
  },
  {
    path: "apps/mobile/assets/adaptive-icon.png",
    source: SOURCES.color,
    size: 1024,
    fraction: FRACTIONS.adaptive,
    background: undefined,
    note: "expo.android.adaptiveIcon.foregroundImage — backgroundColor supplies the layer behind it",
  },
  {
    /**
     * The Android status-bar icon, and the one output whose rules are unlike the rest.
     *
     * **Android throws the colours away.** A notification small icon is drawn from its
     * *alpha channel* alone and tinted by the system, so the full-colour frog would arrive
     * as a solid white square — every opaque pixel, which for an icon with a background is
     * all of them. That is why this one is drawn from `logo_bw.svg`, whose body has no
     * fill: what survives is the outline, which is legible at 24dp precisely because it is
     * mostly holes.
     *
     * 96px because that is the largest size the expo-notifications plugin asks for
     * (24dp × 4 for xxxhdpi); it downscales for the other four densities itself.
     */
    path: "apps/mobile/assets/notification-icon.png",
    source: SOURCES.mono,
    size: 96,
    fraction: FRACTIONS.notification,
    background: undefined,
    tint: "#ffffff",
    note: "expo-notifications plugin `icon` — Android reads its alpha only and tints the result",
  },
  {
    /**
     * The mark as the app draws it *inside itself* — today beside the app's name in the
     * mobile Home title.
     *
     * Transparent, and that is the whole reason it is not `icon.png`: a launcher icon
     * carries its own cream background, which against the header's `surfaceRaised` would
     * read as a slightly-wrong square rather than as a frog. Tightly cropped for the same
     * reason — the padding in the launcher icons is there to survive a mask, and inside
     * the app it would just look like a gap.
     *
     * 256px is a single density rather than the `@2x`/`@3x` set React Native also
     * understands: it is drawn at ~26pt, so even a 3× screen asks for 78px and everything
     * here is downscaling. Three files to avoid one cheap downscale is not a trade worth
     * making.
     */
    path: "apps/mobile/assets/logo.png",
    source: SOURCES.color,
    size: 256,
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "drawn in-app beside the Leapsake wordmark (components/AppHeader.tsx)",
  },
  {
    // The desktop half of the same lockup. A second copy rather than a shared one because
    // each client bundles its own assets — Metro from `apps/mobile/assets`, Vite from the
    // renderer tree — and a path that reached across apps would be a build-graph edge
    // between two things that are otherwise independent. The bytes are identical; the
    // manifest is what keeps them that way.
    path: "apps/desktop/src/renderer/src/assets/logo.png",
    source: SOURCES.color,
    size: 256,
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "drawn in-app beside the Leapsake wordmark (renderer App.tsx)",
  },
  {
    path: "apps/desktop/resources/icon.png",
    source: SOURCES.color,
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
 *
 * Each source is measured separately even though both are the same drawing: `logo_bw.svg`
 * has no fill, so its ink is the stroke *outline* and its box is very slightly larger than
 * the filled one's. Sharing a measurement between them would be a guess that happens to be
 * nearly right, which is the worst kind.
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
 *
 * `tint` recolours every drawn pixel without touching its alpha, via `feColorMatrix`: the
 * last row passes alpha through while the first three ignore the source colour and emit a
 * constant. It has to be a filter rather than a `fill`/`stroke` override, because those are
 * presentation attributes set on the artwork's own elements — a parent cannot win against
 * them, and a blanket `fill` would turn `logo_bw.svg`'s deliberately unfilled body into a
 * solid blob.
 *
 * The filter hangs on a `<g>` *inside* the nested `<svg>`, not on the nested `<svg>` itself.
 * That placement is load-bearing: librsvg stops honouring the inner viewport when the
 * element carrying it is also filtered, and renders the artwork oversized and anchored to
 * the corner instead of fitted and centred. The `<g>` keeps the two jobs on separate
 * elements, which is the arrangement both actually specify.
 */
function wrap({ inner, box, size, fraction, background, tint }) {
  const inset = ((1 - fraction) / 2) * size;
  const edge = size - inset * 2;
  const rect = background
    ? `<rect width="${size}" height="${size}" fill="${background}"/>`
    : "";
  const [r, g, b] = tint
    ? [1, 3, 5].map((at) => Number.parseInt(tint.slice(at, at + 2), 16) / 255)
    : [];
  const filter = tint
    ? `<filter id="tint" color-interpolation-filters="sRGB">` +
      `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 1 0"/>` +
      "</filter>"
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    filter +
    rect +
    `<svg x="${inset}" y="${inset}" width="${edge}" height="${edge}"` +
    ` viewBox="${box.x} ${box.y} ${box.width} ${box.height}" preserveAspectRatio="xMidYMid meet">` +
    (tint ? `<g filter="url(#tint)">${inner}</g>` : inner) +
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

  // Measured and peeled once per source rather than once per output — four outputs share
  // two drawings, and measuring is the expensive half.
  const sources = {};
  for (const source of new Set(OUTPUTS.map((output) => output.source))) {
    sources[source] = {
      sha256: sha256(read(source)),
      contentBox: measureContent(source),
      inner: contentsOf(source),
    };
  }

  const outputs = OUTPUTS.map((output) => {
    const { inner, contentBox } = sources[output.source];
    const svg = wrap({ inner, box: contentBox, ...output });
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
      source: output.source,
      size: output.size,
      fraction: output.fraction,
      background: output.background ?? null,
      tint: output.tint ?? null,
      note: output.note,
      sha256: sha256(png),
    };
  });

  const manifest = {
    // Regenerate with `pnpm icons`; `pnpm test:icons` fails if this drifts from the files.
    sources: Object.fromEntries(
      Object.entries(sources).map(([path, { sha256: hash, contentBox }]) => [
        path,
        { sha256: hash, contentBox },
      ]),
    ),
    outputs,
  };
  writeFileSync(join(ROOT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `\n${outputs.length} icons written from ${Object.keys(sources).length} sources`,
  );
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
  for (const [source, recorded] of Object.entries(manifest.sources)) {
    let actual;
    try {
      actual = sha256(read(source));
    } catch {
      problems.push(
        `${source} is missing, but ${MANIFEST} says the icons were generated from it`,
      );
      continue;
    }
    if (actual !== recorded.sha256) {
      problems.push(
        `${source} has changed since the icons were generated — run \`pnpm icons\``,
      );
    }
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
    `icons agree with ${Object.keys(manifest.sources).join(" and ")} (${manifest.outputs.length} outputs)`,
  );
}

try {
  if (process.argv.includes("--check")) check();
  else generate();
} catch (error) {
  console.error(`icons: ${error.message}`);
  process.exitCode = 1;
}
