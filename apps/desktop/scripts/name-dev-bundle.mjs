// Give the *dev* Electron bundle the dev app's name, so macOS does too.
//
// Three surfaces show an app's name on macOS and **none of them read the same thing**, which
// is the whole reason this script is more than one `plutil` call:
//
//   - The items *inside* the app menu (About…, Hide…, Quit…) come from `app.setName`, which
//     `src/main/index.ts` calls and which reaches neither surface below.
//   - The **menu-bar title** beside the Apple logo reads `CFBundleName` from the bundle's
//     `Info.plist`, live, at launch.
//   - The **Dock tile** reads the bundle's *file name on disk*. macOS resolves an app's
//     display name from the filename and disregards `CFBundleDisplayName` when the two
//     disagree, so no amount of stamping reaches it.
//
// That last one is measured, not reasoned about, because the disagreement can be read from
// two APIs side by side. With the plist stamped and the bundle still called `Electron.app`,
// `NSRunningApplication.localizedName` and LaunchServices' own record for the running process
// both answered “Leapsake Dev”, while `NSFileManager.displayNameAtPath` answered “Electron” —
// and the Dock agreed with the filename. Renaming the directory flips that last answer.
//
// Renaming the *bundle* is not renaming the **executable**, and the difference is load-bearing.
// Electron derives `app.isPackaged` from `basename(process.execPath)`, so a renamed binary
// makes an unpackaged build claim to be packaged — which skips the dev rename in
// `src/main/index.ts` and puts this device's store on the packaged app's path, quietly undoing
// the boundary that split dev from installed in the first place. `Contents/MacOS/Electron`
// therefore keeps its name and only the `.app` around it changes. Probed after the rename:
// `isPackaged` false, `userData` still `…/Leapsake Dev`.
//
// The name written here must match what `src/main/index.ts` calls an unpackaged build, or the
// menu bar and its own items disagree. Both derive it from `productName` and append the same
// suffix; that suffix is the one thing stated in two files.
//
// Editing someone else's package is not free, so the reasons this is the cheap side of the
// trade, in order:
//
//   - Nothing is invalidated. The downloaded bundle is ad-hoc *linker*-signed, and
//     `codesign -dv` reports `Info.plist=not bound` and `Sealed Resources=none` — the
//     signature covers the executable, and has never covered this file or the directory name
//     around it. The renamed bundle launches.
//   - The copy is this repo's own. `node_modules/electron` here is a real directory, not a
//     link into the pnpm store, so no other project on the machine sees the rename.
//   - `dev` already repairs a native binary in `node_modules` on every run
//     (`../../scripts/ensure-sqlite-abi.mjs`). This is the same kind of chore, and it
//     re-applies the same way after an install wipes it.
//   - It is temporary. Once packaging lands (plans/v0-2.md) electron-builder writes a real
//     bundle with a real name and this script stops mattering.
//
// One trap it leaves for that day: electron-builder's `electronDist` can point at a local
// Electron distribution, and `node_modules/electron/dist` is the obvious value to reach for —
// which would hand a *renamed and stamped* bundle to the packager as its template. Left alone
// it downloads its own copy keyed by version, so the default is fine; confirm that before
// setting `electronDist`.
//
// Idempotent, and **never fatal**: a cosmetic name is not worth failing a dev launch over, so
// anything unexpected is a warning and the app starts with the stock title.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * `productName` with the dev suffix — the same string `src/main/index.ts` gives an
 * unpackaged build. Read from `package.json` rather than written out, so renaming the
 * product is one edit in one file.
 */
const NAME = `${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).productName} Dev`;

/** The installed `electron` package — the one `electron-vite dev` is about to launch. */
const PACKAGE = dirname(createRequire(import.meta.url).resolve("electron"));

/** The executable inside the bundle. Never renamed; see the header. */
const EXECUTABLE = "Contents/MacOS/Electron";

/**
 * The `.app` on disk, by directory name: ours if a previous run renamed it, the stock one
 * after a fresh install wiped that. `undefined` if neither is there, which is not this
 * script's problem to report — the launch that follows will say so far more clearly.
 */
function bundle() {
  for (const dir of [`${NAME}.app`, "Electron.app"]) {
    const path = join(PACKAGE, "dist", dir);
    if (existsSync(join(path, "Contents/Info.plist"))) return { dir, path };
  }
  return undefined;
}

/**
 * Point the `electron` package at a bundle directory.
 *
 * `index.js` resolves the binary by reading `path.txt`, so a rename without this is not a
 * cosmetic failure but a broken launch. Written from the directory that is *observed* on
 * disk rather than the one we expect to have made, so a run that died between the two steps
 * is repaired by the next one instead of compounding.
 */
function repoint(dir) {
  const file = join(PACKAGE, "path.txt");
  const value = `${dir}/${EXECUTABLE}`;
  if (readFileSync(file, "utf8").trim() === value) return;
  writeFileSync(file, value);
}

/**
 * Tell LaunchServices to re-read the bundle it has already catalogued.
 *
 * AppKit reads the plist live, which is why the menu bar changes on the next launch; the
 * ⌘-Tab switcher and the Finder read LaunchServices' *database record*, a cached copy taken
 * when the bundle was first seen. Leave it and they keep saying “Electron” under an icon and
 * a menu that say otherwise — the app looks half-renamed, which is worse than not renaming.
 *
 * Called on every run, not only when something changed. Gating it on a change assumes the
 * readers fall out of step together, and they do not: this repo stamped the plist for a day
 * before this function existed, so any machine that ran `dev` in that window has a correct
 * plist and a stale record — the one state a change-gate can never repair. Unconditional
 * costs 28ms, measured, which is not worth reasoning about.
 */
function reregister(path) {
  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks" +
      "/LaunchServices.framework/Support/lsregister",
    ["-f", path],
  );
}

/**
 * One string key, or `undefined` if it is absent or unreadable.
 *
 * `plutil` writes to stderr for a key that is not there, which is the ordinary case on a
 * fresh install; the absence is the answer, so it is swallowed rather than printed.
 */
function read(plist, key) {
  try {
    return execFileSync("plutil", ["-extract", key, "raw", "-o", "-", plist], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function main() {
  // Only macOS names an app from its bundle; Windows and Linux take the name from the
  // window, which the app already sets for itself.
  if (process.platform !== "darwin") return;

  let found = bundle();
  if (found === undefined) return;

  // The Dock's copy of the name, and the only one a plist cannot reach.
  if (found.dir !== `${NAME}.app`) {
    const path = join(PACKAGE, "dist", `${NAME}.app`);
    renameSync(found.path, path);
    found = { dir: `${NAME}.app`, path };
    console.log(`named the dev Electron bundle: ${found.dir}`);
  }
  repoint(found.dir);

  // Both keys, because they are two more surfaces and a half-rename reads as a bug:
  // `CFBundleName` is the menu-bar title, `CFBundleDisplayName` is what the Finder and the
  // ⌘-Tab switcher show. `plutil -replace` inserts a key that is missing.
  const plist = join(found.path, "Contents/Info.plist");
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    if (read(plist, key) === NAME) continue;
    execFileSync("plutil", ["-replace", key, "-string", NAME, plist]);
    console.log(`named the dev Electron bundle: ${key} → ${NAME}`);
  }
  reregister(found.path);
}

try {
  main();
} catch (error) {
  // A launch that cannot find its binary is the one failure worse than a wrong name, so the
  // last act before giving up is to agree with whatever is on disk.
  try {
    const found = bundle();
    if (found !== undefined) repoint(found.dir);
  } catch {}
  console.warn(
    `could not name the dev Electron bundle (${error.message}) — ` +
      "macOS will call the app “Electron”. Continuing.",
  );
}
