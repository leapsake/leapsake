// The shared mobile test harness: everything both mobile tiers need to get a Maestro
// flow in front of a booted device, and nothing about what the flow asserts.
//
// Two tiers sit on this, and the split between them is the same one
// `apps/mobile/maestro/README.md` draws for a single flow:
//
//   - **`scripts/test-native.mjs`** — the driver-contract self-test (one flow, one PASS
//     token).
//   - **`scripts/test-e2e.mjs`** — the crucial-flow catalog (an ordered arc of flows that
//     share state).
//
// This file owns *environment prep* — the flaky, imperative part of driving a dev client —
// and the *platform plumbing*. The Maestro YAML owns the *assertion*, the portable half.
// It was extracted from `test-native.mjs` when the E2E tier arrived (plans/v0-1_06 → D);
// everything here was proven by that tier first, and the comments are its findings.
//
// The file is:
//   - a platform-agnostic CORE — resolve `maestro`, the shared Metro `/status` check,
//     `maestro --udid <device> test <flow>`, and provisioning;
//   - two DRIVERS — `android` (adb) and `ios` (xcrun simctl) — each detecting its booted
//     device, checking the dev-client is installed, and doing its own bundle-load prepare
//     (Android deep-links over adb; iOS drives the dev-launcher via a small Maestro helper
//     flow, because the iOS deep-link path is intercepted by a SpringBoard confirm);
//   - a SUITE runner + CLI (`runSuite`) that both tiers hand a flow list to.
//
// By default it ASSUMES a prepared environment per platform — a booted device, the
// installed dev-client build, and a running Metro dev server — and fails with the exact
// command to run for whichever prerequisite is missing. That is the right answer for the
// inner loop, where the developer already has all three and a "here is the command"
// failure beats a ten-minute native rebuild they did not ask for.
//
// `--provision` inverts it: instead of printing the command, run it. Boot an emulator or
// simulator, build + install the dev client, start Metro — so `pnpm release` is one
// command on a machine (or a CI runner) that has nothing prepared.
//
// Platforms: with no flag, BOTH platforms are attempted and each self-classifies
// (pass / fail / blocked) — an un-booted simulator prints as BLOCKED, never silently
// skipped (principle #6). `--platform=ios|android` runs just one.
//
// Exit codes (aggregated across the platforms run): 0 = at least one passed and none
// failed; 1 = a device was booted but a flow went RED or the env is broken (Metro down
// / app not installed / prepare never reached home); 3 = nothing reachable here (no device
// booted, or the platform toolchain is absent) — *blocked*, not a failure.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const APP_ID = "com.leapsake.app"; // app.json → android.package / ios.bundleIdentifier
export const SCHEME = "leapsake"; // app.json → scheme
const METRO_PORT = 8081;
const METRO_URL = `http://localhost:${METRO_PORT}`;
// Expo dev-server deep link that tells the dev client which packager to load. Uses
// localhost (reachable from the Android emulator via `adb reverse`), so it is machine- and
// LAN-independent. This is open-source Expo/Metro, not a vendor API. Android only — on iOS
// this link is intercepted by a SpringBoard "Open in Leapsake?" confirm and ignored, so
// the iOS driver reconnects through the dev-launcher instead (see the ios driver + the
// ios-prepare.yaml flow it runs).
const DEV_CLIENT_LINK = `${SCHEME}://expo-development-client/?url=${encodeURIComponent(METRO_URL)}`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MAESTRO_DIR = join(ROOT, "apps", "mobile", "maestro");
const IOS_PREPARE_FLOW = join(MAESTRO_DIR, "ios-prepare.yaml"); // iOS bundle-load helper

const HOME_TIMEOUT_MS = 180_000; // budget for the first Metro bundle build → app home
const BOOT_TIMEOUT_MS = 300_000; // budget for a cold emulator/simulator boot
const METRO_TIMEOUT_MS = 120_000; // budget for `expo start` → packager-status:running

// Per-platform outcomes. These are aggregated into the process exit code at the end.
export const PASS = "pass"; // device booted, flows green
export const FAIL = "fail"; // device booted, but a flow went RED or env broken → exit 1
export const BLOCKED = "blocked"; // not reachable here (no device / no toolchain) → exit 3

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

// Metro must be serving (the dev client loads its JS bundle from it). The dev-only routes
// some flows use are __DEV__-only, so a release build won't have them — a running Metro
// implies dev. Memoized: the same host Metro serves every platform, so we probe it once
// per run.
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

/**
 * Run one Maestro flow against a specific device, returning its exit code (0 = green).
 *
 * Both platforms select the device with the top-level `--udid <device>` flag — required
 * here because with an Android emulator *and* an iOS sim booted an un-targeted
 * `maestro test` is ambiguous.
 */
function runMaestroFlow(device, file) {
  const flow = run(maestro, ["--udid", device, "test", file], {
    stdio: "inherit",
  });
  return flow.status ?? 1;
}

// --- shared: provisioning (--provision) ------------------------------------------
//
// Everything below exists so that `pnpm release` can be ONE command. The rest of this
// file deliberately assumes a prepared environment and fails with the command to run;
// under `--provision` it runs those commands itself instead.
//
// It stays opt-in because the two callers want opposite things. A developer in the inner
// loop already has a simulator up and a dev client installed, and would not thank a test
// run for booting a second one or spending ten minutes on a native rebuild — for them the
// "here is the command" failure is the faster answer. A release, and a CI runner, start
// from nothing and must not need a human. So: `pnpm test:native` behaves as it always has,
// and `pnpm release` passes `--provision`.
//
// **What it starts, it stops — and only what it started.** A Metro this script spawned is
// killed on the way out; a Metro that was already serving is left alone, because it is
// almost certainly the developer's own and killing it would be a surprising thing for a
// test run to do. Devices are the other way round: booting one is slow and shutting it
// down again would only make the next run slow too, so they are left booted and reported.

/** The Metro we spawned, if we spawned one. Never a Metro that was already serving. */
let metroStarted = null;

/**
 * Ensure Metro is serving, starting it if it is not.
 *
 * The readiness signal is the same `/status` probe the non-provisioning path uses, polled
 * rather than assumed: `expo start` returns long before the packager answers, so spawning
 * it and proceeding would just move the failure to the next step.
 */
async function ensureMetro() {
  // Drop a memoized *negative*: `expo run:<platform>` starts a dev server of its own, so
  // a `false` probed before the install step may no longer be true. A memoized `true`
  // cannot go stale in the other direction within one run.
  if (metroCache !== true) metroCache = undefined;
  if (await metroReachable()) return { ok: true };

  console.log("  starting Metro (expo start --dev-client)…");
  // detached so it survives this process and can be signalled as a group; Expo spawns
  // workers that would outlive a bare kill of the parent.
  const child = spawn("pnpm", ["--filter", "@leapsake/mobile", "dev"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  metroStarted = child;

  const started = Date.now();
  while (Date.now() - started < METRO_TIMEOUT_MS) {
    await sleep(1000);
    metroCache = undefined; // re-probe; the memoized `false` is what we are fixing
    if (await metroReachable()) {
      console.log(
        `  Metro up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
      );
      return { ok: true };
    }
  }
  return {
    ok: false,
    detail:
      `Metro did not start serving within ${METRO_TIMEOUT_MS / 1000}s. Run it in its own ` +
      "terminal to see why:\n    pnpm --filter @leapsake/mobile dev",
  };
}

/** Kill a Metro this script started. A pre-existing one is never touched. */
function stopMetroIfStarted() {
  if (!metroStarted) return;
  const { pid } = metroStarted;
  metroStarted = null;
  // Negative pid signals the whole process group — see `detached` above.
  try {
    process.kill(-pid, "SIGTERM");
    console.log("\n  stopped the Metro this run started");
  } catch {
    // Already gone, which is the outcome we wanted anyway.
  }
}

/**
 * Build + install the dev client with `expo run:<platform>`, targeting one device.
 *
 * `--device` is passed explicitly rather than letting Expo choose: with more than one
 * simulator booted it prompts interactively, which would hang a release. It takes the name
 * *Expo* knows the device by, which on Android is not the adb serial — see
 * `androidExpoName`. Output is streamed because this is the slowest step by an order of
 * magnitude (a full native build) and a silent ten minutes is indistinguishable from a
 * hang.
 *
 * On iOS this prebuilds a *debug* `apps/mobile/ios/`. That is harmless: the release's own
 * `build()` deletes the directory and prebuilds again for the Release archive, and the
 * gate runs to completion before shipping starts — so nothing from here can reach the
 * artifact.
 */
function installDevClient(platform, device) {
  console.log(
    `  building + installing the dev client (expo run:${platform}) — several minutes…`,
  );
  const built = spawnSync(
    "pnpm",
    [
      "--filter",
      "@leapsake/mobile",
      "exec",
      "expo",
      `run:${platform}`,
      "--device",
      device,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  return built.status === 0;
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

/** The first attached, fully-booted device serial, or undefined. */
const bootedSerial = (adb) =>
  run(adb, ["devices"])
    .stdout.split("\n")
    .slice(1)
    .filter((l) => l.endsWith("\tdevice"))
    .map((l) => l.split("\t")[0])[0];

/**
 * What `expo run:android --device` calls this device — which is **not** its adb serial.
 *
 * Expo resolves the flag against its own device list, and that list names a booted
 * emulator by its **AVD** (`adb emu avd name`), a physical device by its `model:` prop.
 * Passing `emulator-5554` therefore fails with "Could not find device with name:
 * emulator-5554" *while that emulator is plainly attached* — which reads like a broken
 * emulator rather than a wrong flag. Maestro is the other way round and wants the serial,
 * so the two identifiers coexist on purpose: `ctx.device` is the serial everything else
 * uses, and this is the one place that needs Expo's name for it.
 *
 * Falls back to the serial rather than throwing: if the mapping ever fails, letting Expo
 * report what it could not find beats inventing a second error message here.
 */
function androidExpoName(adb, serial) {
  if (serial.startsWith("emulator-")) {
    const name = run(adb, ["-s", serial, "emu", "avd", "name"])
      .stdout?.split("\n")
      .map((line) => line.trim())
      .find((line) => line && line !== "OK");
    if (name) return name;
  }
  const model = run(adb, ["-s", serial, "shell", "getprop", "ro.product.model"])
    .stdout?.trim()
    .replace(/\s+/g, "_");
  return model || serial;
}

/** `emulator` from the SDK, else PATH — the same resolution order as `adb`. */
function resolveEmulator() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  if (sdk) {
    const p = join(sdk, "emulator", "emulator");
    if (existsSync(p)) return p;
  }
  return "emulator";
}

// The three expo-dev-menu settings a *fresh install* gets wrong, all of which break flows
// in ways that do not look like a harness problem:
//
//   - `showFab` — the floating "Tools" bubble. It is an overlay, so a `tapOn` under it
//     reports COMPLETED while the dev menu opens instead, and the flow fails several steps
//     later on an unrelated assertion. Confirmed on `global-nav.yaml` (case 3's
//     `search-here-people`) and suspected on the retired `staged-gift-occasions.yaml`.
//   - `isOnboardingFinished` — the one-time "This is the developer menu" panel, which
//     covers the app on first launch after an install.
//   - `showsAtLaunch` — the dev menu opening over the app on every launch.
//
// The dev client reads these from SharedPreferences at start, so they are settable over
// `adb run-as` (debuggable builds only — which a dev client always is) *while the app is
// stopped*: a running process holds them in memory and would write its copy back over ours.
//
// `mkdir -p` first, because under `--provision` this runs immediately after a **fresh
// install**, and `shared_prefs/` is created by the app's first launch rather than by the
// installer. Without it the redirect fails with "No such file or directory", the run
// continues with the Tools bubble still on, and the flow that dies is several steps later
// somewhere unrelated — the most expensive trap in this harness, arriving through its own
// mitigation.
const DEV_MENU_PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
    <boolean name="showFab" value="false" />
</map>
`;
const DEV_MENU_PREFS_PATH =
  "shared_prefs/expo.modules.devmenu.sharedpreferences.xml";

// Best-effort: a failure here costs flakiness, not correctness, so it warns rather than
// failing the run — the flows themselves are still the gate.
function settleDevMenu(adb, device) {
  run(adb, ["-s", device, "shell", "am", "force-stop", APP_ID]);
  const wrote = run(
    adb,
    [
      "-s",
      device,
      "shell",
      "run-as",
      APP_ID,
      "sh",
      "-c",
      `'mkdir -p ${dirname(DEV_MENU_PREFS_PATH)} && cat > ${DEV_MENU_PREFS_PATH}'`,
    ],
    { input: DEV_MENU_PREFS },
  );
  if (wrote.status !== 0) {
    console.warn(
      "  ! could not settle the dev-menu prefs (run-as failed) — the floating Tools\n" +
        "    button may swallow taps. Turn it off by hand: dev menu → Tools button.",
    );
  }
}

/**
 * Every installed package that claims `leapsake://`.
 *
 * More than one is an environment fault with a distinctive failure: Android answers the
 * deep link with an **"Open with" chooser** listing two apps called Leapsake, the chooser
 * sits over everything, and the flow fails on whatever it asserted next — `tab-search is
 * not visible`, which reads as a broken app or a wrong selector. It cost a session on the
 * first Android E2E run, where the second claimant was this repo's own **previous package
 * name** (`net.leapsake.mobile`, renamed to `com.leapsake.app`) still installed on the
 * emulator from before the rename.
 *
 * Detected rather than worked around, because there is nothing to work around: Maestro's
 * `openLink` cannot name a package, so a device with two claimants cannot run these flows
 * at all. What the harness owes is a failure that says so.
 */
function schemeClaimants(adb, device) {
  const out = run(adb, [
    "-s",
    device,
    "shell",
    "cmd",
    "package",
    "query-activities",
    "-a",
    "android.intent.action.VIEW",
    "-c",
    "android.intent.category.BROWSABLE",
    "-d",
    `${SCHEME}://`,
  ]).stdout;
  if (!out) return [];
  const names = out
    .split("\n")
    .map((line) => line.match(/^\s*packageName=(\S+)/)?.[1])
    .filter(Boolean);
  return [...new Set(names)];
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
    const serial = bootedSerial(adb);
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

  // --provision: boot the first defined AVD and wait for Android to finish coming up.
  // `sys.boot_completed` is the signal rather than adb's mere presence — the daemon
  // answers well before the framework is up, and installing into a half-booted system
  // fails in ways that read like a build error.
  async boot() {
    const emulator = resolveEmulator();
    const list = run(emulator, ["-list-avds"]);
    if (list.status !== 0) {
      return {
        ok: false,
        detail:
          "`emulator` not found — install the Android SDK emulator package and set " +
          "ANDROID_HOME (Android Studio → SDK Manager).",
      };
    }
    // `-list-avds` prints one name per line, but the binary also emits the odd INFO
    // banner; an AVD name has no whitespace, which is enough to tell them apart.
    const avd = list.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/\s/.test(l))[0];
    if (!avd) {
      return {
        ok: false,
        detail:
          "no AVD is defined — create one in Android Studio → Device Manager, then " +
          "re-run.",
      };
    }

    console.log(`  booting the Android emulator (${avd})…`);
    const child = spawn(emulator, ["-avd", avd], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const adb = resolveAdb();
    const started = Date.now();
    while (Date.now() - started < BOOT_TIMEOUT_MS) {
      const serial = bootedSerial(adb);
      if (
        serial &&
        run(adb, [
          "-s",
          serial,
          "shell",
          "getprop",
          "sys.boot_completed",
        ]).stdout?.trim() === "1"
      ) {
        console.log(
          `  emulator up (${((Date.now() - started) / 1000).toFixed(0)}s)`,
        );
        return { ok: true };
      }
      await sleep(2000);
    }
    return {
      ok: false,
      detail: `the emulator did not finish booting within ${BOOT_TIMEOUT_MS / 1000}s`,
    };
  },

  install: (ctx) =>
    installDevClient("android", androidExpoName(ctx.adb, ctx.device)),

  // Load the JS bundle and wait for the app home. On Android a deep link does this
  // deterministically (no SpringBoard-style confirm), so we drive it over adb here rather
  // than through Maestro. Returns { ok, detail }.
  async prepare(ctx) {
    const { adb, device } = ctx;
    // Exactly one app may answer `leapsake://`, or the chooser eats every deep link.
    const claimants = schemeClaimants(adb, device);
    const strangers = claimants.filter((name) => name !== APP_ID);
    if (strangers.length > 0) {
      return {
        ok: false,
        detail:
          `${claimants.length} installed apps claim ${SCHEME}:// on this device, so ` +
          'Android answers every deep link with an "Open with" chooser that covers the\n' +
          "  app — the flows cannot drive past it. Uninstall the others:\n" +
          strangers
            .map((name) => `    adb -s ${device} uninstall ${name}`)
            .join("\n"),
      };
    }
    // Reverse-tunnel so the emulator reaches the host's Metro at localhost:8081.
    run(adb, [
      "-s",
      device,
      "reverse",
      `tcp:${METRO_PORT}`,
      `tcp:${METRO_PORT}`,
    ]);
    // Put the dev menu in a state that does not fight the flows. This force-stops the app,
    // so it has to come before the deep link that launches it.
    settleDevMenu(adb, device);
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
    // Wait for the app's home screen, keyed on the Search tab's `testID` — absent from the
    // dev-launcher, which only has Home/Updates/Settings. This absorbs the first Metro
    // bundle build. It is the same signal `ios-prepare.yaml` waits for, deliberately: this
    // used to key on a "People" tab, which increment 09 removed, and the runner then spun
    // the full timeout on an app that was in fact up. An id survives a label change.
    const started = Date.now();
    while (Date.now() - started < HOME_TIMEOUT_MS) {
      const dump =
        run(adb, ["-s", device, "exec-out", "uiautomator", "dump", "/dev/tty"])
          .stdout ?? "";
      if (/resource-id="tab-search"/.test(dump)) {
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

// iOS has the same floating dev-menu button as Android and it bites the same way — an
// overlay that turns a `tapOn` underneath it into "the dev menu opened instead". It cost
// the retired `staged-gift-occasions.yaml` its whole run: the button's stored position sat over the add
// screen's holiday row, so `stage-christmas`'s `tapOn: below: "Add a holiday"` hit the
// button and the flow died three cases in. Hiding it turned the same unmodified flow green
// on all five cases.
//
// The key is read through UserDefaults (`expo-dev-menu`'s DevMenuPreferences.swift), so
// `simctl spawn defaults write` sets it — while the app is stopped, since a running process
// would write its own copy back over ours. Best-effort, like the Android side: a failure
// costs flakiness, not correctness.
//
// The build ALSO carries this key in Info.plist (`ios.infoPlist` in app.json), which is the
// stronger half: it survives a reinstall and covers running a flow directly, which bypasses
// this script entirely. This step stays because Info.plist only supplies a *registered
// default* — an explicit UserDefaults value, which any dev who has ever toggled the button
// by hand now has, silently outranks it.
const IOS_FAB_KEY = "EXDevMenuShowFloatingActionButton";

function settleDevMenuIos(device) {
  run("xcrun", ["simctl", "terminate", device, APP_ID]);
  const wrote = run("xcrun", [
    "simctl",
    "spawn",
    device,
    "defaults",
    "write",
    APP_ID,
    IOS_FAB_KEY,
    "-bool",
    "false",
  ]);
  if (wrote.status !== 0) {
    console.warn(
      "  ! could not hide the dev-menu floating button — it may swallow taps. Turn it\n" +
        "    off by hand: dev menu → Floating action button.",
    );
  }
}

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

  // --provision: boot the first available iPhone simulator. An iPhone specifically —
  // the flows are phone-shaped, and `simctl list` will happily offer an iPad or a Watch.
  async boot() {
    const available = run("xcrun", [
      "simctl",
      "list",
      "devices",
      "available",
    ]).stdout;
    const match = available
      .split("\n")
      .map((line) =>
        line.match(/^\s+(iPhone[^(]*)\(([0-9A-Fa-f-]{36})\) \(Shutdown\)/),
      )
      .find(Boolean);
    if (!match) {
      return {
        ok: false,
        detail:
          "no available iPhone simulator — add a runtime in Xcode → Settings → " +
          "Components, then re-run.",
      };
    }
    const [, name, udid] = match;

    console.log(`  booting the iOS simulator (${name.trim()})…`);
    if (run("xcrun", ["simctl", "boot", udid]).status !== 0) {
      return { ok: false, detail: `could not boot the simulator ${udid}` };
    }
    // Bring the Simulator UI up: Maestro drives the window, and a headless-booted device
    // has no window to drive.
    run("open", ["-a", "Simulator"]);
    // `bootstatus -b` blocks until the device is all the way up, so no poll is needed.
    if (run("xcrun", ["simctl", "bootstatus", udid, "-b"]).status !== 0) {
      return {
        ok: false,
        detail: `the simulator ${udid} never finished booting`,
      };
    }
    console.log("  simulator up");
    return { ok: true };
  },

  install: (ctx) => installDevClient("ios", ctx.device),

  // iOS has no working bundle-load deep link (the SpringBoard confirm intercepts it), so
  // instead we reconnect through the dev-launcher's "Continue" (last dev server = the one
  // the `pnpm --filter @leapsake/mobile ios` prerequisite set) via a small Maestro helper
  // flow. That flow also clears any SpringBoard/dev-menu overlay and waits for the Search
  // tab, so its exit 0 *is* the "home reached" signal — no separate hierarchy poll here.
  async prepare(ctx) {
    settleDevMenuIos(ctx.device);
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

/**
 * Drive a single platform end to end, returning { key, label, status, detail }.
 *
 * Steps 1–4 are the environment; step 5 is the suite's own flows. A suite is an ordered
 * arc — `test:e2e`'s catalog flows share app state, so the first red one ends the
 * platform rather than letting the rest fail as noise against a store that never got the
 * rows they assume.
 */
async function runPlatform(driver, provision, suite) {
  const wrap = (status, detail) => ({
    key: driver.key,
    label: driver.label,
    status,
    detail,
  });

  // 1. toolchain present + a device booted (else blocked — not reachable here).
  let ctx = driver.detect();
  if (ctx.status === BLOCKED) {
    if (!provision) return wrap(BLOCKED, ctx.detail);
    // Under --provision an un-booted device is a thing to fix, not a verdict. A missing
    // *toolchain* still is one, and stays BLOCKED: `boot()` reports "no emulator binary"
    // and "no AVD defined" the same way, because neither is something this can install.
    console.log(
      `\n→ ${suite.key} — ${driver.label}: preparing the environment`,
    );
    const booted = await driver.boot();
    if (!booted.ok) return wrap(BLOCKED, booted.detail);
    ctx = driver.detect();
    if (ctx.status === BLOCKED) {
      // Booted, and still not visible — that is a broken environment, not an absent one.
      return wrap(
        FAIL,
        `booted, but no device was detected afterwards:\n${ctx.detail}`,
      );
    }
  }

  console.log(`\n→ ${suite.key} — ${driver.label} ${suite.what} (Maestro)`);
  console.log(`  device: ${ctx.device}`);

  // 2. dev-client installed (booted but not installed = broken env → fail).
  if (!driver.installed(ctx)) {
    if (!provision) return wrap(FAIL, driver.installHint);
    if (!driver.install(ctx)) {
      return wrap(
        FAIL,
        `expo run:${driver.key} failed — the build output above says why`,
      );
    }
    if (!driver.installed(ctx)) {
      return wrap(
        FAIL,
        `expo run:${driver.key} reported success but ${APP_ID} is still not installed`,
      );
    }
  }

  // 3. Metro serving (host-side, shared across platforms).
  if (provision) {
    const metro = await ensureMetro();
    if (!metro.ok) return wrap(FAIL, metro.detail);
  } else if (!(await metroReachable())) {
    return wrap(
      FAIL,
      `Metro dev server is not reachable at ${METRO_URL}. Start it with:\n` +
        "    pnpm --filter @leapsake/mobile dev",
    );
  }

  // 4. load the bundle + wait for the app home (platform-specific prepare).
  let prep = await driver.prepare(ctx);
  if (!prep.ok && provision) {
    // The gap `installed()` cannot see: iOS reconnects through the dev-launcher's
    // *remembered* dev server, which is set by launching the dev client — not by
    // installing it. A build that is present but has never been launched against this
    // Metro therefore passes step 2 and then times out here. `expo run:` both installs
    // and launches, so running it once is the repair; incremental, so it is cheap when
    // the native side is already built. Once only — a second failure is a real one.
    console.log("  prepare failed — relaunching the dev client against Metro…");
    if (!driver.install(ctx)) {
      return wrap(FAIL, `expo run:${driver.key} failed:\n${prep.detail}`);
    }
    prep = await driver.prepare(ctx);
  }
  if (!prep.ok) return wrap(FAIL, prep.detail);

  // 5. run the suite's flows in order; the first red one is the verdict.
  for (const flow of suite.flows) {
    console.log(
      `\n  ▸ ${flow.label}  [${flow.file.replace(MAESTRO_DIR, "…")}]\n`,
    );
    if (runMaestroFlow(ctx.device, flow.file) !== 0) {
      return wrap(FAIL, `flow RED: ${flow.label} (${flow.file})`);
    }
  }
  return wrap(PASS);
}

// --- CLI + aggregation -----------------------------------------------------------

/**
 * The whole CLI for a mobile tier: parse the flags, check Maestro, run the selected
 * platforms, print the summary, and exit with the aggregated code.
 *
 * A suite is `{ key, title, what, flows }` — `key` names the pnpm script in messages,
 * `what` completes "<platform> <what> (Maestro)", and `flows` is the ordered arc.
 */
export async function runSuite(suite) {
  const args = process.argv.slice(2);
  const platArg = args.find((a) => a.startsWith("--platform="));
  const requested = platArg ? platArg.slice("--platform=".length).trim() : null;
  if (requested && !DRIVERS[requested]) {
    console.error(
      `\n✖ ${suite.key} — unknown --platform="${requested}". Use ios or android.\n`,
    );
    process.exit(2);
  }

  // Maestro drives every platform; if it's missing nothing can run → blocked (exit 3).
  if (!maestroPresent()) {
    console.error(
      `\n⏳ ${suite.key} — Maestro not found (BLOCKED). Install it with:\n` +
        '    curl -Ls "https://get.maestro.mobile.dev" | bash\n' +
        "  then restart your shell (or ensure ~/.maestro/bin is on PATH).\n",
    );
    process.exit(3);
  }

  // No flag = attempt both platforms and let each self-classify, so an un-booted simulator
  // shows as BLOCKED rather than being silently skipped (principle #6).
  const selected = requested
    ? [DRIVERS[requested]]
    : [androidDriver, iosDriver];

  // --provision: prepare whatever is missing rather than reporting it. Off by default —
  // see the provisioning section. `pnpm release` passes it; the inner loop does not.
  const provision = args.includes("--provision");

  // A Metro we started is ours to clean up however this run ends, including Ctrl-C.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      stopMetroIfStarted();
      process.exit(130);
    });
  }

  const results = [];
  for (const driver of selected) {
    results.push(await runPlatform(driver, provision, suite));
  }
  stopMetroIfStarted();

  // Summary — one line per platform, with the guidance for anything not green.
  const icon = { [PASS]: "✅", [FAIL]: "❌", [BLOCKED]: "⏳" };
  const word = { [PASS]: "PASS", [FAIL]: "FAIL", [BLOCKED]: "BLOCKED" };
  console.log(`\n${"─".repeat(48)}`);
  console.log(suite.title);
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
}
