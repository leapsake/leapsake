// Gives the dev Electron bundle the dev app's name, for macOS's three name
// surfaces; see `apps/desktop/README.md` → _How the dev bundle gets its name_.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** `productName` with the dev suffix, as `src/main/index.ts` names an
 *  unpackaged build. */
const NAME = `${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).productName} Dev`;

/** The installed `electron` package that `electron-vite dev` will launch. */
const PACKAGE = dirname(createRequire(import.meta.url).resolve("electron"));

/** ⚠️ Never renamed: its name decides `app.isPackaged`. */
const EXECUTABLE = "Contents/MacOS/Electron";

/** The `.app` on disk, renamed or stock, or `undefined`, which the launch
 *  reports better. */
function bundle() {
  for (const dir of [`${NAME}.app`, "Electron.app"]) {
    const path = join(PACKAGE, "dist", dir);
    if (existsSync(join(path, "Contents/Info.plist"))) return { dir, path };
  }
  return undefined;
}

/** Points `path.txt` at the bundle observed on disk, so a half-done run is
 *  repaired rather than compounded. */
function repoint(dir) {
  const file = join(PACKAGE, "path.txt");
  const value = `${dir}/${EXECUTABLE}`;
  if (readFileSync(file, "utf8").trim() === value) return;
  writeFileSync(file, value);
}

/** Re-registers the bundle with LaunchServices, whose cached record ⌘-Tab
 *  and Finder read; every run, as a stale record is invisible. */
function reregister(path) {
  execFileSync(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks" +
      "/LaunchServices.framework/Support/lsregister",
    ["-f", path],
  );
}

/** One string key, or `undefined`; `plutil`'s stderr for a missing key is
 *  swallowed. */
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
  // Only macOS names an app from its bundle.
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

  // `CFBundleName` names the menu bar, `CFBundleDisplayName` Finder and ⌘-Tab.
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
  // A launch that can't find its binary is worse than a wrong name.
  try {
    const found = bundle();
    if (found !== undefined) repoint(found.dir);
  } catch {}
  console.warn(
    `could not name the dev Electron bundle (${error.message}) — ` +
      "macOS will call the app “Electron”. Continuing.",
  );
}
