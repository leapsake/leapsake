// The mobile native test tier (testing backlog step 3b): drive the in-app
// driver-contract self-test on an Android emulator from the command line and assert
// PASS, so the mobile driver leg is a *terminal, automated* gate rather than a human
// opening `leapsake://dev-selftest` and reading the screen (principle #1: automate over
// manual). See `plans/testing/` for the strategy and `plans/testing/mobile-engine.md`
// for why this must run on an emulator (expo-sqlite's native engine can't load
// headlessly).
//
// This is what `pnpm test:native` runs (NOT the orchestrator — that would loop:
// test-all --only=native -> pnpm test:native -> test-all …). The orchestrator's
// `native` tier calls `pnpm test:native`, which lands here.
//
// Shape: this script owns *environment prep* (the flaky, imperative part of driving a
// dev client); the Maestro flow (`apps/mobile/maestro/driver-selftest.yaml`) owns the
// *assertion* (the portable, vendor-neutral part). It:
//   1. resolves `adb` + `maestro`, failing with exact install commands if absent;
//   2. ASSUMES a prepared environment — a booted emulator, the installed dev-client
//      build, and a running Metro dev server — and fails with the exact command to run
//      for whichever prerequisite is missing (it does not boot/install/start them; that
//      is heavier and is the developer's one-time setup, documented in the maestro
//      README);
//   3. loads the JS bundle into the dev client via the Expo dev-server deep link and
//      waits for the app's home screen (a cold dev-client launch shows the
//      expo-dev-launcher, not the app — Maestro can't reliably drive past it, so we do
//      it deterministically here over adb);
//   4. runs the Maestro flow and propagates its exit code (non-zero = the self-test
//      reported FAIL/ERROR, or never finished).
//
// Android-first by decision (the emulator is the verified-local target). iOS is a
// follow-on: the flow is platform-identical, so it is mostly a device-target add here
// (resolve `xcrun simctl`, `openurl` the same deep links). Not implemented yet.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const APP_ID = "net.leapsake.mobile"; // app.json → android.package
const SCHEME = "leapsake"; // app.json → scheme
const METRO_PORT = 8081;
const METRO_URL = `http://localhost:${METRO_PORT}`;
// Expo dev-server deep link that tells the dev client which packager to load. Uses
// localhost (reachable from the emulator via `adb reverse`), so it is machine- and
// LAN-independent. This is open-source Expo/Metro, not a vendor API.
const DEV_CLIENT_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;
const SELFTEST_LINK = `${SCHEME}://dev-selftest`;
const FLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "mobile",
  "maestro",
  "driver-selftest.yaml",
);

const die = (msg) => {
  console.error(`\n✖ test:native — ${msg}\n`);
  process.exit(1);
};

// --- resolve tools ---------------------------------------------------------------

// `adb` from the Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT), else PATH.
function resolveAdb() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "platform-tools", "adb");
    if (existsSync(p)) return p;
  }
  return "adb"; // fall back to PATH
}

// `maestro` from its default install dir (~/.maestro/bin — the installer adds this to
// PATH only in login shells, which a `pnpm` subprocess may not be), else PATH.
function resolveMaestro() {
  const p = join(homedir(), ".maestro", "bin", "maestro");
  if (existsSync(p)) return p;
  return "maestro";
}

const adb = resolveAdb();
const maestro = resolveMaestro();

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });

// Probe each tool exists/runs; give the exact install command if not.
if (run(adb, ["version"]).status !== 0) {
  die(
    "`adb` not found. Install the Android SDK platform-tools and set ANDROID_HOME " +
      "(e.g. via Android Studio), or add `adb` to PATH.",
  );
}
if (run(maestro, ["--version"]).status !== 0) {
  die(
    'Maestro not found. Install it with:\n    curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
      "  then restart your shell (or ensure ~/.maestro/bin is on PATH).",
  );
}

// --- check the prepared environment ----------------------------------------------

// A booted device/emulator must be attached.
const devices = run(adb, ["devices"])
  .stdout.split("\n")
  .slice(1)
  .filter((l) => l.endsWith("\tdevice"));
if (devices.length === 0) {
  die(
    "no booted Android emulator. Boot one, e.g.:\n" +
      "    emulator -list-avds\n" +
      "    emulator -avd <name>\n" +
      "  or build+install+launch the dev client in one go:\n" +
      "    pnpm --filter @leapsake/mobile android",
  );
}

// The dev-client build must be installed.
const installed = run(adb, [
  "shell",
  "pm",
  "list",
  "packages",
  APP_ID,
]).stdout.includes(APP_ID);
if (!installed) {
  die(
    `the dev-client build (${APP_ID}) is not installed. Build + install it with:\n` +
      "    pnpm --filter @leapsake/mobile android",
  );
}

// Metro must be serving (the dev client loads its JS bundle from it). The self-test is
// __DEV__-only, so a release build won't have the route — a running Metro implies dev.
const metroOk = await fetch(`${METRO_URL}/status`, {
  signal: AbortSignal.timeout(3000),
})
  .then((r) => r.text())
  .then((t) => t.includes("packager-status:running"))
  .catch(() => false);
if (!metroOk) {
  die(
    `Metro dev server is not reachable at ${METRO_URL}. Start it with:\n` +
      "    pnpm --filter @leapsake/mobile dev",
  );
}

// --- load the bundle + wait for the app ------------------------------------------

console.log(
  "→ test:native — mobile driver-contract self-test (Maestro, Android)",
);
console.log(`  adb: ${adb}`);
console.log(`  device: ${devices[0].split("\t")[0]}`);

// Reverse-tunnel so the emulator reaches the host's Metro at localhost:8081.
run(adb, ["reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`]);

// Load the JS bundle by pointing the dev client at Metro. A cold launch alone opens the
// expo-dev-launcher; this deep link makes it load the app.
console.log("  loading JS bundle into the dev client…");
run(adb, [
  "shell",
  "am",
  "start",
  "-a",
  "android.intent.action.VIEW",
  "-d",
  DEV_CLIENT_LINK,
  APP_ID,
]);

// Wait for the app's home screen (its "People" tab — absent from the dev-launcher,
// which only has Home/Updates/Settings). This absorbs the first Metro bundle build.
const HOME_TIMEOUT_MS = 180_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
let home = false;
while (Date.now() - started < HOME_TIMEOUT_MS) {
  const dump =
    run(adb, ["exec-out", "uiautomator", "dump", "/dev/tty"]).stdout ?? "";
  if (/(text|content-desc)="People"/.test(dump)) {
    home = true;
    break;
  }
  await sleep(2000);
}
if (!home) {
  die(
    "the app's home screen never appeared within " +
      `${HOME_TIMEOUT_MS / 1000}s of loading the bundle. Check the Metro output for a ` +
      "bundling error, and that the installed build is the current dev client " +
      "(re-run `pnpm --filter @leapsake/mobile android` if a native module changed).",
  );
}
console.log(`  app home up (${((Date.now() - started) / 1000).toFixed(0)}s)`);

// --- run the flow ----------------------------------------------------------------

console.log(`  deep link + assert PASS via Maestro (${SELFTEST_LINK})\n`);
const flow = spawnSync(maestro, ["test", FLOW], { stdio: "inherit" });
process.exit(flow.status ?? 1);
