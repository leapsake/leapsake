// The mobile native test tier (testing backlog steps 3b + 9): drive the in-app
// driver-contract self-test on a booted device — Android emulator and/or iOS simulator —
// from the command line and assert PASS, so the mobile driver leg is a *terminal,
// automated* gate rather than a human opening `leapsake://dev-selftest` and reading the
// screen (principle #1: automate over manual). See AGENTS.md → Testing for the principles and
// `apps/mobile/README.md` → *Why the driver test needs a device* for why this must run on a real device (expo-sqlite's
// native engine can't load headlessly).
//
// This is what `pnpm test:native` runs (NOT the orchestrator — that would loop:
// test-all --only=native -> pnpm test:native -> test-all …). `scripts/test-all.mjs`
// runs each platform via `pnpm test:native --platform=<x>` and maps our exit code.
//
// Shape: this script owns *environment prep* (the flaky, imperative part of driving a
// dev client) and the *platform plumbing*; the Maestro flow
// (`apps/mobile/maestro/driver-selftest.yaml`) owns the *assertion* (the portable,
// vendor-neutral part) and is byte-identical across platforms. The file is split into:
//   - a platform-agnostic CORE — resolve `maestro`, the shared Metro `/status` check,
//     the flow path, `maestro --udid <device> test FLOW`, PASS/FAIL messaging, and
//     cross-platform aggregation;
//   - two DRIVERS — `android` (adb) and `ios` (xcrun simctl) — each detecting its booted
//     device, checking the dev-client is installed, and doing its own bundle-load prepare
//     (Android deep-links over adb; iOS drives the dev-launcher via a small Maestro helper
//     flow, because the iOS deep-link path is intercepted by a SpringBoard confirm).
//
// It ASSUMES a prepared environment per platform — a booted device, the installed
// dev-client build, and a running Metro dev server — and fails with the exact command to
// run for whichever prerequisite is missing (it does not boot/install/start them; that is
// heavier and is the developer's one-time setup, documented in the maestro README).
//
// Platforms: with no flag, BOTH platforms are attempted and each self-classifies
// (pass / fail / blocked) — an un-booted simulator prints as BLOCKED, never silently
// skipped (principle #6). `--platform=ios|android` runs just one.
//
// Exit codes (aggregated across the platforms run): 0 = at least one passed and none
// failed; 1 = a device was booted but the flow went RED or the env is broken (Metro down
// / app not installed / prepare never reached home); 3 = nothing reachable here (no device
// booted, or the platform toolchain is absent) — *blocked*, not a failure.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const APP_ID = "com.leapsake.app"; // app.json → android.package / ios.bundleIdentifier
const SCHEME = "leapsake"; // app.json → scheme
const METRO_PORT = 8081;
const METRO_URL = `http://localhost:${METRO_PORT}`;
// Expo dev-server deep link that tells the dev client which packager to load. Uses
// localhost (reachable from the Android emulator via `adb reverse`), so it is machine- and
// LAN-independent. This is open-source Expo/Metro, not a vendor API. Android only — on iOS
// this link is intercepted by a SpringBoard "Open in Leapsake?" confirm and ignored, so
// the iOS driver reconnects through the dev-launcher instead (see the ios driver + the
// ios-prepare.yaml flow it runs).
const DEV_CLIENT_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;
const SELFTEST_LINK = `${SCHEME}://dev-selftest`;

const MAESTRO_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "mobile",
  "maestro",
);
const FLOW = join(MAESTRO_DIR, "driver-selftest.yaml"); // the shared assertion
const IOS_PREPARE_FLOW = join(MAESTRO_DIR, "ios-prepare.yaml"); // iOS bundle-load helper

const HOME_TIMEOUT_MS = 180_000; // budget for the first Metro bundle build → app home

// Per-platform outcomes. These are aggregated into the process exit code at the end.
const PASS = "pass"; // device booted, flow green
const FAIL = "fail"; // device booted, but flow RED or env broken → exit 1
const BLOCKED = "blocked"; // not reachable here (no device / no toolchain) → exit 3

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { encoding: "utf8", ...opts });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- shared: maestro + Metro -----------------------------------------------------

// `maestro` from its default install dir (~/.maestro/bin — the installer adds this to
// PATH only in login shells, which a `pnpm` subprocess may not be), else PATH.
function resolveMaestro() {
  const p = join(homedir(), ".maestro", "bin", "maestro");
  if (existsSync(p)) return p;
  return "maestro";
}
const maestro = resolveMaestro();

const maestroPresent = () => run(maestro, ["--version"]).status === 0;

// Metro must be serving (the dev client loads its JS bundle from it). The self-test is
// __DEV__-only, so a release build won't have the route — a running Metro implies dev.
// Memoized: the same host Metro serves every platform, so we probe it once per run.
let metroCache;
async function metroReachable() {
  if (metroCache !== undefined) return metroCache;
  metroCache = await fetch(`${METRO_URL}/status`, {
    signal: AbortSignal.timeout(3000),
  })
    .then((r) => r.text())
    .then((t) => t.includes("packager-status:running"))
    .catch(() => false);
  return metroCache;
}

// Run the shared Maestro assertion flow against a specific device. Returns its exit code
// (0 = self-test reported PASS; non-zero = FAIL/ERROR, or it never finished). Both
// platforms select the device with the top-level `--udid <device>` flag — required here
// because with an Android emulator *and* an iOS sim booted an un-targeted `maestro test`
// is ambiguous.
function runFlow(device) {
  console.log(`  deep link + assert PASS via Maestro (${SELFTEST_LINK})\n`);
  const flow = run(maestro, ["--udid", device, "test", FLOW], {
    stdio: "inherit",
  });
  return flow.status ?? 1;
}

// --- android driver --------------------------------------------------------------

// `adb` from the Android SDK (ANDROID_HOME / ANDROID_SDK_ROOT), else PATH.
function resolveAdb() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "platform-tools", "adb");
    if (existsSync(p)) return p;
  }
  return "adb"; // fall back to PATH
}

const androidDriver = {
  key: "android",
  label: "Android",

  // { status, detail } — a terminal blocked/fail result, or { device } to proceed.
  detect() {
    const adb = resolveAdb();
    if (run(adb, ["version"]).status !== 0) {
      return {
        status: BLOCKED,
        detail:
          "`adb` not found. Install the Android SDK platform-tools and set ANDROID_HOME " +
          "(e.g. via Android Studio), or add `adb` to PATH.",
      };
    }
    // A booted device/emulator must be attached.
    const serial = run(adb, ["devices"])
      .stdout.split("\n")
      .slice(1)
      .filter((l) => l.endsWith("\tdevice"))
      .map((l) => l.split("\t")[0])[0];
    if (!serial) {
      return {
        status: BLOCKED,
        detail:
          "no booted Android emulator. Boot one, e.g.:\n" +
          "    emulator -list-avds\n" +
          "    emulator -avd <name>\n" +
          "  or build+install+launch the dev client in one go:\n" +
          "    pnpm --filter @leapsake/mobile android",
      };
    }
    return { adb, device: serial };
  },

  // The dev-client build must be installed.
  installed(ctx) {
    return run(ctx.adb, [
      "-s",
      ctx.device,
      "shell",
      "pm",
      "list",
      "packages",
      APP_ID,
    ]).stdout.includes(APP_ID);
  },

  installHint:
    `the dev-client build (${APP_ID}) is not installed. Build + install it with:\n` +
    "    pnpm --filter @leapsake/mobile android",

  // Load the JS bundle and wait for the app home. On Android a deep link does this
  // deterministically (no SpringBoard-style confirm), so we drive it over adb here rather
  // than through Maestro. Returns { ok, detail }.
  async prepare(ctx) {
    const { adb, device } = ctx;
    // Reverse-tunnel so the emulator reaches the host's Metro at localhost:8081.
    run(adb, [
      "-s",
      device,
      "reverse",
      `tcp:${METRO_PORT}`,
      `tcp:${METRO_PORT}`,
    ]);
    // Load the JS bundle by pointing the dev client at Metro. A cold launch alone opens
    // the expo-dev-launcher; this deep link makes it load the app.
    console.log("  loading JS bundle into the dev client…");
    run(adb, [
      "-s",
      device,
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
    const started = Date.now();
    while (Date.now() - started < HOME_TIMEOUT_MS) {
      const dump =
        run(adb, ["-s", device, "exec-out", "uiautomator", "dump", "/dev/tty"])
          .stdout ?? "";
      if (/(text|content-desc)="People"/.test(dump)) {
        console.log(
          `  app home up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
        );
        return { ok: true };
      }
      await sleep(2000);
    }
    return {
      ok: false,
      detail:
        "the app's home screen never appeared within " +
        `${HOME_TIMEOUT_MS / 1000}s of loading the bundle. Check the Metro output for a ` +
        "bundling error, and that the installed build is the current dev client " +
        "(re-run `pnpm --filter @leapsake/mobile android` if a native module changed).",
    };
  },
};

// --- ios driver ------------------------------------------------------------------

const iosDriver = {
  key: "ios",
  label: "iOS",

  detect() {
    // `xcrun simctl` gates the whole iOS path (Xcode command-line tools). Absent on
    // non-macOS hosts and Macs without Xcode → the iOS tier is blocked here, not failed.
    if (run("xcrun", ["simctl", "help"]).status !== 0) {
      return {
        status: BLOCKED,
        detail:
          "`xcrun simctl` not found — iOS simulators need Xcode + its command-line tools " +
          "(macOS only). Install Xcode, then `xcode-select --install`.",
      };
    }
    // A booted simulator must exist. `simctl list devices booted` prints one line per
    // booted sim, each ending in "(<UDID>) (Booted)".
    const booted = run("xcrun", ["simctl", "list", "devices", "booted"]).stdout;
    const udid = booted.match(/\(([0-9A-Fa-f-]{36})\) \(Booted\)/)?.[1];
    if (!udid) {
      return {
        status: BLOCKED,
        detail:
          "no booted iOS simulator. Boot one, e.g.:\n" +
          "    xcrun simctl list devices available\n" +
          "    xcrun simctl boot <udid>   # then: open -a Simulator\n" +
          "  or build+install+launch the dev client in one go:\n" +
          "    pnpm --filter @leapsake/mobile ios",
      };
    }
    return { device: udid };
  },

  // Installed iff the app has a data container on the sim.
  installed(ctx) {
    return (
      run("xcrun", ["simctl", "get_app_container", ctx.device, APP_ID])
        .status === 0
    );
  },

  installHint:
    `the dev-client build (${APP_ID}) is not installed on the simulator. Build + install ` +
    "it with:\n    pnpm --filter @leapsake/mobile ios",

  // iOS has no working bundle-load deep link (the SpringBoard confirm intercepts it), so
  // instead we reconnect through the dev-launcher's "Continue" (last dev server = the one
  // the `pnpm --filter @leapsake/mobile ios` prerequisite set) via a small Maestro helper
  // flow. That flow also clears any SpringBoard/dev-menu overlay and waits for the People
  // tab, so its exit 0 *is* the "home reached" signal — no separate hierarchy poll here.
  async prepare(ctx) {
    console.log("  loading JS bundle via the dev-launcher (ios-prepare)…");
    const prep = run(maestro, ["--udid", ctx.device, "test", IOS_PREPARE_FLOW]);
    if (prep.status === 0) return { ok: true };
    return {
      ok: false,
      detail:
        "the app's home screen never appeared. The iOS prepare reconnects through the " +
        "dev-launcher's last dev server — make sure it was set by launching the dev " +
        "client at least once:\n    pnpm --filter @leapsake/mobile ios\n" +
        "  Also check the Metro output for a bundling error, and that the installed build " +
        "is the current dev client (rebuild if a native module changed).",
    };
  },
};

const DRIVERS = { android: androidDriver, ios: iosDriver };

// --- run one platform ------------------------------------------------------------

// Drive a single platform end to end, returning { key, label, status, detail }.
async function runPlatform(driver) {
  const wrap = (status, detail) => ({
    key: driver.key,
    label: driver.label,
    status,
    detail,
  });

  // 1. toolchain present + a device booted (else blocked — not reachable here).
  const ctx = driver.detect();
  if (ctx.status === BLOCKED) return wrap(BLOCKED, ctx.detail);

  console.log(
    `\n→ test:native — ${driver.label} driver-contract self-test (Maestro)`,
  );
  console.log(`  device: ${ctx.device}`);

  // 2. dev-client installed (booted but not installed = broken env → fail).
  if (!driver.installed(ctx)) return wrap(FAIL, driver.installHint);

  // 3. Metro serving (host-side, shared across platforms).
  if (!(await metroReachable())) {
    return wrap(
      FAIL,
      `Metro dev server is not reachable at ${METRO_URL}. Start it with:\n` +
        "    pnpm --filter @leapsake/mobile dev",
    );
  }

  // 4. load the bundle + wait for the app home (platform-specific prepare).
  const prep = await driver.prepare(ctx);
  if (!prep.ok) return wrap(FAIL, prep.detail);

  // 5. run the shared assertion flow; its exit code is the verdict.
  const code = runFlow(ctx.device);
  return wrap(code === 0 ? PASS : FAIL);
}

// --- CLI + aggregation -----------------------------------------------------------

const args = process.argv.slice(2);
const platArg = args.find((a) => a.startsWith("--platform="));
const requested = platArg ? platArg.slice("--platform=".length).trim() : null;
if (requested && !DRIVERS[requested]) {
  console.error(
    `\n✖ test:native — unknown --platform="${requested}". Use ios or android.\n`,
  );
  process.exit(2);
}

// Maestro drives every platform; if it's missing nothing can run → blocked (exit 3).
if (!maestroPresent()) {
  console.error(
    "\n⏳ test:native — Maestro not found (BLOCKED). Install it with:\n" +
      '    curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
      "  then restart your shell (or ensure ~/.maestro/bin is on PATH).\n",
  );
  process.exit(3);
}

// No flag = attempt both platforms and let each self-classify, so an un-booted simulator
// shows as BLOCKED rather than being silently skipped (principle #6).
const selected = requested ? [DRIVERS[requested]] : [androidDriver, iosDriver];

const results = [];
for (const driver of selected) results.push(await runPlatform(driver));

// Summary — one line per platform, with the guidance for anything not green.
const icon = { [PASS]: "✅", [FAIL]: "❌", [BLOCKED]: "⏳" };
const word = { [PASS]: "PASS", [FAIL]: "FAIL", [BLOCKED]: "BLOCKED" };
console.log(`\n${"─".repeat(48)}`);
console.log("test:native — mobile driver-contract");
console.log("─".repeat(48));
for (const r of results) {
  console.log(`${icon[r.status]}  ${word[r.status].padEnd(8)} ${r.label}`);
  if (r.detail) {
    for (const line of r.detail.split("\n")) console.log(`      ${line}`);
  }
}
console.log("─".repeat(48));

// Aggregate: any fail → 1; else any pass → 0; else all blocked → 3.
if (results.some((r) => r.status === FAIL)) process.exit(1);
if (results.some((r) => r.status === PASS)) process.exit(0);
process.exit(3);
