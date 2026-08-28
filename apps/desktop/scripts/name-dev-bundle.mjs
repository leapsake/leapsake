// Give the *dev* Electron bundle the dev app's name, so macOS's menu bar does too.
//
// macOS takes the name beside the Apple logo — and the one the Dock shows under the icon —
// from the running bundle, and nothing the app does at runtime can reach either:
// `app.setName` renames everything *inside* the app menu (About…, Hide…, Quit…) and leaves
// the title and the Dock alone. In dev the bundle is
// `node_modules/electron/dist/Electron.app`, so both say “Electron”, and the app is nameless
// on the one platform it is developed on.
//
// Renaming the *executable* would fix the Dock too and must not be done: Electron derives
// `app.isPackaged` from its basename, so a renamed binary makes an unpackaged build claim to
// be packaged — which skips the dev rename in `src/main/index.ts` and puts this device's
// store on the packaged app's path. Measured, not guessed.
//
// The name written here must match what `src/main/index.ts` calls an unpackaged build, or
// the menu bar and its own items disagree. Both derive it from `productName` and append the
// same suffix; that suffix is the one thing stated in two files.
//
// Editing someone else's package is not free, so the reasons this is the cheap side of the
// trade, in order:
//
//   - Nothing is invalidated. The downloaded bundle is ad-hoc *linker*-signed, and
//     `codesign -dv` reports `Info.plist=not bound` and `Sealed Resources=none` — the
//     signature covers the executable and has never covered this file.
//   - The copy is this repo's own. `node_modules/electron` here is a real directory, not a
//     link into the pnpm store, so no other project on the machine sees the rename.
//   - `dev` already repairs a native binary in `node_modules` on every run
//     (`../../scripts/ensure-sqlite-abi.mjs`). This is the same kind of chore, and it
//     re-applies the same way after an install wipes it.
//   - It is temporary. Once packaging lands (plans/v0-2.md) electron-builder writes a real
//     bundle with a real name and this script stops mattering.
//
// Idempotent, and **never fatal**: a cosmetic name is not worth failing a dev launch over,
// so anything unexpected is a warning and the app starts with the stock title.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * `productName` with the dev suffix — the same string `src/main/index.ts` gives an
 * unpackaged build. Read from `package.json` rather than written out, so renaming the
 * product is one edit in one file.
 */
const NAME = `${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).productName} Dev`;

/**
 * The Electron.app that `electron-vite dev` is about to launch.
 *
 * Resolved through `require.resolve` rather than a hand-written `node_modules` path so it
 * follows whatever layout the package manager chose. `undefined` if the binary has not
 * been downloaded yet, which is not this script's problem to report — the launch that
 * follows will say so far more clearly.
 */
function bundle() {
  const path = join(
    dirname(createRequire(import.meta.url).resolve("electron")),
    "dist/Electron.app",
  );
  return existsSync(join(path, "Contents/Info.plist")) ? path : undefined;
}

/**
 * Tell LaunchServices to re-read the bundle it has already catalogued.
 *
 * Editing `Info.plist` is not enough on its own, because **two different things read the
 * name.** AppKit reads the plist live, which is why the menu bar changes on the next
 * launch; the Dock reads LaunchServices' *database record* for the bundle, which is a
 * cached copy taken when the bundle was first seen. Leave it and the Dock keeps saying
 * “Electron” under an icon and a menu that say otherwise — the app looks half-renamed,
 * which is worse than not renaming it.
 *
 * Only called when a key actually changed, since re-registering is the slow part and the
 * overwhelmingly common case is a stamp that is already correct.
 */
function reregister(path) {
  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks" +
      "/LaunchServices.framework/Support/lsregister",
    ["-f", path],
  );
}

/** One string key, or `undefined` if it is absent or unreadable. */
function read(plist, key) {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
      encoding: "utf8",
    }).trim();
  } catch {
    return undefined;
  }
}

function main() {
  // Only macOS reads a bundle to name a menu; Windows and Linux take the name from the
  // window, which the app already sets for itself.
  if (process.platform !== "darwin") return;

  const path = bundle();
  if (path === undefined) return;
  const plist = join(path, "Contents/Info.plist");

  // Both keys, because they are two different surfaces and a half-rename reads as a bug:
  // `CFBundleName` is the menu-bar title, `CFBundleDisplayName` is what the Finder and the
  // ⌘-Tab switcher show. `plutil -replace` inserts a key that is missing.
  let changed = false;
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    if (read(plist, key) === NAME) continue;
    execFileSync("plutil", ["-replace", key, "-string", NAME, plist]);
    changed = true;
    console.log(`named the dev Electron bundle: ${key} → ${NAME}`);
  }
  if (changed) reregister(path);
}

try {
  main();
} catch (error) {
  console.warn(
    `could not name the dev Electron bundle (${error.message}) — ` +
      "macOS will call the app “Electron”. Continuing.",
  );
}
