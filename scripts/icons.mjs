// Renders every icon from `assets/icon/`; `--check` compares hashes instead.
// See `assets/icon/README.md`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "assets/icon/generated.json";

/** The artwork: `color`, and `mono` without its fill, for one-colour use. */
const SOURCES = {
  color: "assets/icon/logo_color.svg",
  mono: "assets/icon/logo_bw.svg",
};

/** `tokens.surface` from `@leapsake/ui`, duplicated and not checked; see the
 *  README. */
const BACKGROUND = "#fbf7f0";

/** How much of each canvas the artwork spans, as measured; see the README's
 *  _How the framing is measured_. */
const FRACTIONS = {
  masked: 0.72,
  adaptive: 0.49,
  notification: 0.85,
  bare: 0.96,
};

/** The rounded tile a macOS icon is drawn on, from Apple's grid, as fractions
 *  of the canvas and of the body. */
const PLATE = { fraction: 824 / 1024, radius: 185.4 / 824 };

/** The OpenMoji credit inside `favicon.svg`; see the README's _Attribution_. */
const CREDIT =
  "<!-- Frog (U+1F438) from OpenMoji (https://openmoji.org), CC BY-SA 4.0 -->";

/** Every output; no `background` is transparent, and an `ico`'s `size` is the
 *  render its frames are reduced from. */
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
    // Play's listing icon, uploaded by hand: exactly 512px, framed like
    // `icon.png`, and ⚠️ opaque, as Play rejects alpha.
    path: "assets/store/google-play-icon.png",
    source: SOURCES.color,
    size: 512,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "Google Play store listing icon — uploaded to the Console by hand, consumed by no build",
  },
  {
    // Android draws this from alpha alone, so the line art, at the plugin's
    // largest size.
    path: "apps/mobile/assets/notification-icon.png",
    source: SOURCES.mono,
    size: 96,
    fraction: FRACTIONS.notification,
    background: undefined,
    tint: "#ffffff",
    note: "expo-notifications plugin `icon` — Android reads its alpha only and tints the result",
  },
  {
    // The mark inside the app: transparent, tight, one density.
    path: "apps/mobile/assets/logo.png",
    source: SOURCES.color,
    size: 256,
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "drawn in-app beside the Leapsake wordmark (components/AppHeader.tsx)",
  },
  {
    // The desktop's own copy, as each client bundles its own assets.
    path: "apps/desktop/src/renderer/src/assets/logo.png",
    source: SOURCES.color,
    size: 256,
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "drawn in-app beside the Leapsake wordmark (renderer App.tsx)",
  },
  {
    // Full-bleed: Windows and Linux frame it; macOS ignores a window icon.
    path: "apps/desktop/resources/icon.png",
    source: SOURCES.color,
    size: 1024,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "the Electron window icon on Windows and Linux, and the master electron-builder will slice when desktop packaging lands (plans/v0-2.md)",
  },
  {
    // The macOS Dock icon, drawn on its tile; see the README's _Why macOS gets
    // its own file_.
    path: "apps/desktop/resources/icon-macos.png",
    source: SOURCES.color,
    size: 1024,
    fraction: FRACTIONS.masked,
    plate: PLATE,
    background: BACKGROUND,
    note: "app.dock.setIcon in the main process, and the master for icon.icns when desktop packaging lands (plans/v0-2.md)",
  },
  {
    // The vector favicon, sharp at every tab size; see the README's _The
    // website's three_.
    path: "apps/website/public/favicon.svg",
    source: SOURCES.color,
    format: "svg",
    size: 256,
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "leapsake.com — <link rel=icon type=image/svg+xml> in apps/website/src/layouts/Base.astro",
  },
  {
    // The fallback favicon, its filename load-bearing; frames reduced from 256
    // so thin strokes survive as grey.
    path: "apps/website/public/favicon.ico",
    source: SOURCES.color,
    format: "ico",
    size: 256,
    frames: [48, 32, 16],
    fraction: FRACTIONS.bare,
    background: undefined,
    note: "leapsake.com — served at the origin root, which is where a browser looks when markup does not say",
  },
  {
    // The home-screen icon, opaque and framed like `icon.png`.
    path: "apps/website/public/apple-touch-icon.png",
    source: SOURCES.color,
    size: 180,
    fraction: FRACTIONS.masked,
    background: BACKGROUND,
    note: "leapsake.com — <link rel=apple-touch-icon>, and what iOS reads for an Add to Home Screen",
  },
];

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

const read = (relative) => readFileSync(join(ROOT, relative));

/** Checks every tool the script runs, so one run reports both missing. */
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

/** The artwork's inked box in source units, measured from a transparent render
 *  rather than the off-centre `viewBox`. */
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
  // Back into source units, to read beside the viewBox.
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
    /** The box's half-diagonal, as a fraction of its longest edge. */
    contentRadius: Math.hypot(w, h) / 2 / Math.max(w, h),
  };
}

/** Places the ink in a square canvas with a nested `<svg>`, tinting by filter
 *  on an inner `<g>`; see the README. */
function wrap({ inner, box, size, fraction, background, tint, plate }) {
  const plateEdge = plate ? plate.fraction * size : size;
  const inset = (size - plateEdge * fraction) / 2;
  const edge = size - inset * 2;
  const platedRect = () => {
    const at = (size - plateEdge) / 2;
    return (
      `<rect x="${at}" y="${at}" width="${plateEdge}" height="${plateEdge}"` +
      ` rx="${plate.radius * plateEdge}" fill="${background}"/>`
    );
  };
  const rect = background
    ? plate
      ? platedRect()
      : `<rect width="${size}" height="${size}" fill="${background}"/>`
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

/** A wrapped SVG as its bytes: itself, a PNG, or that PNG reduced to `.ico`
 *  frames, largest first as the format stores them. */
function render(svg, { format = "png", size, frames }) {
  if (format === "svg") return Buffer.from(`${CREDIT}\n${svg}\n`);
  const png = execFileSync(
    "rsvg-convert",
    ["-w", String(size), "-h", String(size)],
    { input: svg, maxBuffer: 64 * 1024 * 1024 },
  );
  if (format === "png") return png;
  return execFileSync(
    "magick",
    ["png:-", "-define", `icon:auto-resize=${frames.join(",")}`, "ico:-"],
    { input: png, maxBuffer: 64 * 1024 * 1024 },
  );
}

/** Asserts each output's alpha channel, which a store rejects an upload over;
 *  see the README. */
function assertAlpha(bytes, { path, background, plate, format = "png" }) {
  // A plated icon needs both a background and alpha around its tile.
  const opaque = background !== undefined && plate === undefined;
  // Reads like "srgba 4.0", run together once per `.ico` frame; the frames
  // of one file cannot differ, being reductions of one PNG.
  const channels = execFileSync(
    "magick",
    ["identify", "-format", "%[channels]", `${format}:-`],
    { input: bytes, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const [colorspace] = channels.trim().split(/\s+/);
  const hasAlpha = colorspace.endsWith("a");
  if (opaque && hasAlpha) {
    throw new Error(
      `${path} carries an alpha channel; iOS rejects an app icon that does. ` +
        "The rasterizer no longer drops it for an opaque canvas — flatten before writing.",
    );
  }
  if (!opaque && !hasAlpha) {
    throw new Error(
      `${path} lost its alpha channel; an Android adaptive foreground needs one so it does ` +
        "not paint over the layer it sits on, a macOS plate needs one to have a shape, and a " +
        "favicon needs one to sit on the browser's tab colour rather than on a cream square.",
    );
  }
}

/** The source's drawable children, its root `<svg>` peeled off. */
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

  // Once per source, not per output: measuring is the expensive half.
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
    const bytes = render(svg, output);
    // An SVG's transparency is simply no `<rect>`.
    if (output.format !== "svg") assertAlpha(bytes, output);
    const absolute = join(ROOT, output.path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, bytes);
    const shape =
      output.format === "svg"
        ? "vector"
        : output.frames
          ? output.frames.map((frame) => `${frame}²`).join(" ")
          : `${output.size}²`;
    console.log(
      `  ${output.path}  ${shape}  ${output.background ?? "transparent"}  ${bytes.length.toLocaleString()} bytes`,
    );
    return {
      path: output.path,
      source: output.source,
      format: output.format ?? "png",
      size: output.size,
      frames: output.frames ?? null,
      fraction: output.fraction,
      background: output.background ?? null,
      plate: output.plate ?? null,
      tint: output.tint ?? null,
      note: output.note,
      sha256: sha256(bytes),
    };
  });

  const manifest = {
    // `pnpm icons` regenerates; `pnpm test:icons` fails on drift.
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
